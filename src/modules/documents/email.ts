import { tenantDb } from "@/server/db";
import { deliver } from "@/server/email";
import { emails } from "@/server/emails";
import { generateDocument } from "./render";

export type DocumentEmail = { kind: "INVOICE" | "QUOTATION"; id: string; to: string; locale: string; link?: string; userId: string };

/**
 * Worker side of "send": the PDF must exist before the email goes out, and the send is logged on the
 * customer's timeline (CRM-11). Retries are safe: the invoice PDF is generated once; a quotation PDF is reused
 * if this job already produced one.
 */
export async function sendDocumentEmail(tenantId: string, p: DocumentEmail) {
  const db = tenantDb(tenantId);
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { legalNameEn: true, legalNameAr: true } });
  const agency = (p.locale === "ar" && t.legalNameAr) || t.legalNameEn;
  let docId: string;
  if (p.kind === "INVOICE") docId = await generateDocument(tenantId, "INVOICE", p.id);
  else {
    const q = await db.quotation.findUniqueOrThrow({ where: { id: p.id }, select: { sentAt: true } });
    const existing = await db.document.findFirst({ where: { generated: true, entityType: "Quotation", entityId: p.id, createdAt: { gte: q.sentAt ?? new Date(0) } }, orderBy: { createdAt: "desc" } });
    docId = existing?.id ?? (await generateDocument(tenantId, "QUOTATION", p.id, undefined, p.userId));
  }
  const doc = await db.document.findUniqueOrThrow({ where: { id: docId } });
  const record = p.kind === "INVOICE"
    ? await db.invoice.findUniqueOrThrow({ where: { id: p.id }, select: { number: true, customerId: true, bookingId: true } })
    : await db.quotation.findUniqueOrThrow({ where: { id: p.id }, select: { number: true, customerId: true } });
  const mail = p.kind === "INVOICE" ? emails.invoice(p.locale, p.to, agency, record.number ?? "") : emails.quotation(p.locale, p.to, agency, record.number ?? "", p.link!);
  await deliver({ ...mail, attachments: [{ filename: doc.filename, storageKey: doc.storageKey, contentType: "application/pdf" }] });
  await db.interaction.create({
    data: {
      tenantId, customerId: record.customerId, bookingId: "bookingId" in record ? (record.bookingId as string | null) : null, channel: "EMAIL", direction: "OUT",
      subject: mail.subject, body: `${mail.subject} → ${p.to}`, occurredAt: new Date(), userId: p.userId,
    },
  });
}
