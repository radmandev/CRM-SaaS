import { getObject } from "@/server/storage";
import { can, type Ctx } from "@/server/context";
import { forbidden, notFound } from "@/server/errors";
import { enqueue } from "@/server/jobs";
import { scopeWhere } from "@/server/scope";
import { branchScope, isoDate } from "@/modules/finance/common";

// §14.4 generated documents. Issued financial PDFs are generated once and kept (immutability);
// quotation, confirmation and voucher PDFs are regenerated on request. Rendering lives in ./render (worker).

export type DocKind = "INVOICE" | "RECEIPT" | "QUOTATION" | "CONFIRMATION" | "VOUCHER";

/** Queue a (re)generation; the page shows "PDF generating" until the document exists (FR-07). */
export async function requestDocument(ctx: Ctx, kind: DocKind, id: string, itemId?: string) {
  await assertCanRead(ctx, kind === "VOUCHER" || kind === "CONFIRMATION" ? "Booking" : kind === "RECEIPT" ? "Payment" : kind === "INVOICE" ? "Invoice" : "Quotation", id);
  await enqueue(ctx.db, "pdf.render", { kind, id, itemId, userId: ctx.user.id }, { tenantId: ctx.tenant.id, dedupeKey: kind === "INVOICE" ? `pdf:INVOICE:${id}` : undefined });
  return { queued: true };
}

export async function latestDocuments(ctx: Ctx, entityType: string, entityIds: string[]) {
  return ctx.db.document.findMany({ where: { generated: true, entityType, entityId: { in: entityIds } }, orderBy: { createdAt: "desc" }, select: { id: true, category: true, filename: true, entityId: true, createdAt: true } });
}

/** Read permission on the record that owns a generated document (DOC-07). */
async function assertCanRead(ctx: Ctx, entityType: string, entityId: string) {
  const found =
    entityType === "Invoice" ? (can(ctx, "invoice:read") ? await ctx.db.invoice.count({ where: { id: entityId, ...branchScope(ctx, "invoice:read") } }) : 0)
    : entityType === "Payment" ? (can(ctx, "invoice:read") ? await ctx.db.payment.count({ where: { id: entityId, ...branchScope(ctx, "invoice:read") } }) : 0)
    : entityType === "Quotation" ? (can(ctx, "quotation:read") ? await ctx.db.quotation.count({ where: { id: entityId, ...scopeWhere(ctx, "quotation:read") } }) : 0)
    : entityType === "Booking" ? (can(ctx, "booking:read") ? await ctx.db.booking.count({ where: { id: entityId, ...scopeWhere(ctx, "booking:read") } }) : 0)
    : entityType === "BookingItem" ? (can(ctx, "booking:read") ? await ctx.db.bookingItem.count({ where: { id: entityId, booking: scopeWhere(ctx, "booking:read") } }) : 0)
    : 0;
  if (!found) throw notFound();
}

export async function downloadDocument(ctx: Ctx, id: string) {
  const doc = await ctx.db.document.findUnique({ where: { id } });
  if (!doc || !doc.generated || !doc.entityId) throw notFound();
  await assertCanRead(ctx, doc.entityType, doc.entityId);
  if (doc.category === "INVOICE" && !can(ctx, "invoice:read")) throw forbidden();
  return { body: await getObject(doc.storageKey), filename: doc.filename, mimeType: doc.mimeType };
}

export { isoDate };
