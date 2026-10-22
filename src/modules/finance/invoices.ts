import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { TenantTx } from "@/server/db";
import { audit, diff } from "@/server/audit";
import { authorize, can, type Ctx } from "@/server/context";
import { AppError, conflict, notFound, unprocessable } from "@/server/errors";
import { after, page } from "@/server/pagination";
import { D, lineTax, round, str, sum, type Money } from "@/server/money";
import { enqueue } from "@/server/jobs";
import { lockBooking } from "@/server/db/raw/bookings";
import { lockInvoices } from "@/server/db/raw/finance";
import { nextSequenceValue } from "@/server/db/raw/sequences";
import { nextDocumentNumber } from "@/modules/tenancy/service";
import { scopeWhere } from "@/server/scope";
import { customerPrice } from "@/modules/bookings/rules";
import { branchScope, isoDate, rateToBase, toDay } from "./common";
import { zatcaQr } from "./zatca";
import type { creditNoteSchema, invoiceCreateSchema, invoiceLineSchema, invoiceUpdateSchema } from "@/lib/schemas-finance";
import type { listQuery } from "@/lib/schemas";

type TaxSnap = { code: string; rate: string; category: string; zatcaCode: string; exemptionReasonCode?: string | null };
const NO_TAX: TaxSnap = { code: "NONE", rate: "0", category: "OUT_OF_SCOPE", zatcaCode: "O" };

// ───────── Reads ─────────

export async function listInvoices(ctx: Ctx, q: z.infer<typeof listQuery> & { kind?: "INVOICE" | "CREDIT_NOTE"; status?: "DRAFT" | "ISSUED"; customerId?: string; unpaid?: boolean }) {
  const rows = await ctx.db.invoice.findMany({
    where: {
      ...branchScope(ctx, "invoice:read"),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.q ? { OR: [{ number: { contains: q.q, mode: "insensitive" } }, { customer: { displayName: { contains: q.q, mode: "insensitive" } } }] } : {}),
      ...after(q.cursor, "createdAt", "desc"),
    },
    select: { id: true, kind: true, type: true, number: true, status: true, issuedAt: true, dueDate: true, currency: true, total: true, amountPaid: true, amountCredited: true, createdAt: true, customer: { select: { id: true, displayName: true } }, bookingId: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  const p = page(rows, q.limit, (r) => r.createdAt);
  const data = p.data.map((i) => ({ ...i, dueDate: isoDate(i.dueDate), outstanding: i.kind === "INVOICE" ? i.total.minus(i.amountCredited).minus(i.amountPaid) : null }));
  return { ...p, data: q.unpaid ? data.filter((i) => i.status === "ISSUED" && i.outstanding && i.outstanding.greaterThan(0)) : data };
}

async function loadInvoice(ctx: Ctx, db: TenantTx, id: string) {
  const inv = await db.invoice.findFirst({ where: { id, ...branchScope(ctx, "invoice:read") } });
  if (!inv) throw notFound();
  return inv;
}

export async function getInvoice(ctx: Ctx, id: string) {
  const inv = await ctx.db.invoice.findFirst({
    where: { id, ...branchScope(ctx, "invoice:read") },
    include: {
      lines: { orderBy: { sortOrder: "asc" }, include: { creditLines: { select: { totalAmount: true } } } },
      customer: { select: { id: true, code: true, displayName: true, email: true, vatNumber: true, address: true } },
      booking: { select: { id: true, reference: true } },
      original: { select: { id: true, number: true } },
      creditNotes: { select: { id: true, number: true, total: true, issuedAt: true, reason: true } },
      allocations: { where: { releasedAt: null }, include: { payment: { select: { id: true, number: true, date: true, method: true } } } },
      pdfDocument: { select: { id: true, createdAt: true } },
    },
  });
  if (!inv) throw notFound();
  return {
    ...inv,
    supplyDate: isoDate(inv.supplyDate),
    dueDate: isoDate(inv.dueDate),
    outstanding: inv.kind === "INVOICE" ? inv.total.minus(inv.amountCredited).minus(inv.amountPaid) : null,
    lines: inv.lines.map(({ creditLines, ...l }) => ({ ...l, creditable: l.totalAmount.minus(sum(creditLines.map((c) => c.totalAmount))) })),
    permissions: {
      issue: inv.status === "DRAFT" && can(ctx, "invoice:issue"),
      credit: inv.status === "ISSUED" && inv.kind === "INVOICE" && can(ctx, "creditnote:issue") && inv.amountCredited.lessThan(inv.total),
      recordPayment: inv.status === "ISSUED" && inv.kind === "INVOICE" && can(ctx, "payment:record"),
    },
  };
}

// ───────── Line maths (TAX-04) ─────────

function computeLine(qty: Money, unit: Money, discount: Money, rate: Money, inclusive: boolean, currency: string) {
  const base = round(qty.times(unit).minus(discount), currency);
  if (base.isNegative()) throw unprocessable("DISCOUNT_TOO_HIGH", "Discount exceeds the line amount", "discount");
  const tax = lineTax(base, rate, inclusive, currency);
  return inclusive ? { net: base.minus(tax), tax, total: base } : { net: base, tax, total: base.plus(tax) };
}

async function refreshTotals(tx: TenantTx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true } });
  const net = sum(inv.lines.map((l) => l.netAmount));
  const tax = sum(inv.lines.map((l) => l.taxAmount));
  const total = sum(inv.lines.map((l) => l.totalAmount));
  const discount = sum(inv.lines.map((l) => l.discount));
  await tx.invoice.update({
    where: { id: invoiceId },
    data: { subtotal: net.plus(discount), discountTotal: discount, taxableAmount: net, taxAmount: tax, total, baseTotal: round(total.times(inv.exchangeRate), "SAR"), version: { increment: 1 } },
  });
}

async function taxSnapshot(tx: TenantTx, taxRateId: string | null | undefined): Promise<{ snap: TaxSnap; rate: Money; id: string | null }> {
  if (!taxRateId) return { snap: NO_TAX, rate: D(0), id: null };
  const tr = await tx.taxRate.findFirst({ where: { id: taxRateId, active: true } });
  if (!tr) throw unprocessable("INVALID_TAX_RATE", "Tax rate not found", "taxRateId");
  return { snap: { code: tr.code, rate: tr.rate.toString(), category: tr.category, zatcaCode: tr.zatcaCode, exemptionReasonCode: tr.exemptionReasonCode }, rate: tr.rate, id: tr.id };
}

// ───────── Drafts ─────────

const invoiceTypeFor = (c: { type: string; vatNumber: string | null }) => (c.type === "CORPORATE" && c.vatNumber ? "STANDARD" : "SIMPLIFIED");

/** INV-02: a draft with one line per active, not-yet-invoiced service of the booking. */
async function draftFromBooking(ctx: Ctx, bookingId: string) {
  const b = await ctx.db.booking.findFirst({ where: { id: bookingId, ...scopeWhere(ctx, "booking:read") }, include: { customer: true } });
  if (!b) throw notFound();
  const items = await ctx.db.bookingItem.findMany({ where: { bookingId, invoicedQuantity: 0, status: { notIn: ["CANCELLED", "FAILED"] } }, orderBy: { sortOrder: "asc" } });
  if (!items.length) throw unprocessable("NOTHING_TO_INVOICE", "Every active service of this booking is already invoiced");
  return ctx.db.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        tenantId: ctx.tenant.id, type: invoiceTypeFor(b.customer), customerId: b.customerId, branchId: b.branchId, bookingId, currency: b.currency,
        exchangeRate: b.exchangeRate, pricesIncludeTax: b.pricesIncludeTax, createdById: ctx.user.id,
      },
    });
    for (const [n, i] of items.entries()) {
      const gross = customerPrice(i);
      const total = b.pricesIncludeTax ? gross : gross.plus(i.taxAmount);
      await tx.invoiceLine.create({
        data: {
          tenantId: ctx.tenant.id, invoiceId: inv.id, bookingItemId: i.id, descriptionEn: i.description, quantity: 1,
          unitPrice: str(i.sellAmount.plus(i.serviceFeeAmount)), discount: i.discountAmount, taxRateId: i.taxRateId,
          taxRateSnapshot: (i.taxRateSnapshot ?? NO_TAX) as Prisma.InputJsonValue,
          netAmount: str(total.minus(i.taxAmount)), taxAmount: i.taxAmount, totalAmount: str(total), sortOrder: n,
        },
      });
    }
    await refreshTotals(tx, inv.id);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "invoice.draft_created", entityType: "Invoice", entityId: inv.id, parentEntityType: "Booking", parentEntityId: bookingId, metadata: { lines: items.length } });
    return { id: inv.id };
  });
}

async function addLineTx(ctx: Ctx, tx: TenantTx, inv: { id: string; currency: string; pricesIncludeTax: boolean }, line: z.infer<typeof invoiceLineSchema>, sortOrder: number) {
  const { snap, rate, id } = await taxSnapshot(tx, line.taxRateId);
  const c = computeLine(D(line.quantity), D(line.unitPrice), D(line.discount), rate, inv.pricesIncludeTax, inv.currency);
  return tx.invoiceLine.create({
    data: {
      tenantId: ctx.tenant.id, invoiceId: inv.id, descriptionEn: line.descriptionEn, descriptionAr: line.descriptionAr ?? null, quantity: line.quantity,
      unitPrice: line.unitPrice, discount: line.discount, taxRateId: id, taxRateSnapshot: snap as Prisma.InputJsonValue,
      netAmount: str(c.net), taxAmount: str(c.tax), totalAmount: str(c.total), sortOrder,
    },
  });
}

export async function createInvoice(ctx: Ctx, input: z.infer<typeof invoiceCreateSchema>) {
  authorize(ctx, "invoice:issue");
  if ("bookingId" in input) return draftFromBooking(ctx, input.bookingId);
  const customer = await ctx.db.customer.findFirst({ where: { id: input.customerId, mergedIntoId: null, ...scopeWhere(ctx, "customer:read") } });
  if (!customer) throw unprocessable("INVALID_CUSTOMER", "Customer not found", "customerId");
  const branchId = input.branchId ?? ctx.membership.primaryBranchId;
  return ctx.db.$transaction(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { baseCurrency: true, enabledCurrencies: true, pricesIncludeTax: true } });
    const currency = input.currency ?? t.baseCurrency;
    if (!t.enabledCurrencies.includes(currency)) throw unprocessable("CURRENCY_NOT_ENABLED", "This currency is not enabled", "currency");
    const inv = await tx.invoice.create({
      data: {
        tenantId: ctx.tenant.id, type: invoiceTypeFor(customer), customerId: customer.id, branchId, currency, exchangeRate: await rateToBase(tx, currency, t.baseCurrency),
        pricesIncludeTax: t.pricesIncludeTax, notes: input.notes ?? null, createdById: ctx.user.id,
      },
    });
    for (const [n, l] of input.lines.entries()) await addLineTx(ctx, tx, inv, l, n);
    await refreshTotals(tx, inv.id);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "invoice.draft_created", entityType: "Invoice", entityId: inv.id, metadata: { lines: input.lines.length } });
    return { id: inv.id };
  });
}

async function draftForEdit(ctx: Ctx, tx: TenantTx, id: string) {
  authorize(ctx, "invoice:issue");
  const inv = await loadInvoice(ctx, tx, id);
  await lockInvoices(tx, ctx.tenant.id, [id]);
  const fresh = await tx.invoice.findUniqueOrThrow({ where: { id } });
  if (fresh.status !== "DRAFT") throw conflict("INVOICE_ISSUED", "Issued invoices cannot be changed; issue a credit note instead"); // INV-03
  return { ...inv, ...fresh };
}

export async function updateDraft(ctx: Ctx, id: string, input: z.infer<typeof invoiceUpdateSchema>) {
  return ctx.db.$transaction(async (tx) => {
    const inv = await draftForEdit(ctx, tx, id);
    if (inv.version !== input.version) throw conflict("VERSION_CONFLICT", "This invoice was changed by someone else");
    const data = { type: input.type, supplyDate: input.supplyDate ? toDay(input.supplyDate) : null, notes: input.notes ?? null };
    await tx.invoice.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
    const changes = diff(inv, data);
    if (changes) await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "invoice.draft_updated", entityType: "Invoice", entityId: id, changes });
  });
}

export async function addDraftLine(ctx: Ctx, id: string, line: z.infer<typeof invoiceLineSchema>) {
  return ctx.db.$transaction(async (tx) => {
    const inv = await draftForEdit(ctx, tx, id);
    const l = await addLineTx(ctx, tx, inv, line, await tx.invoiceLine.count({ where: { invoiceId: id } }));
    await refreshTotals(tx, id);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "invoice.line_added", entityType: "InvoiceLine", entityId: l.id, parentEntityType: "Invoice", parentEntityId: id });
    return { id: l.id };
  });
}

export async function removeDraftLine(ctx: Ctx, id: string, lineId: string) {
  await ctx.db.$transaction(async (tx) => {
    await draftForEdit(ctx, tx, id);
    await tx.invoiceLine.delete({ where: { id: lineId, invoiceId: id } });
    await refreshTotals(tx, id);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "invoice.line_removed", entityType: "InvoiceLine", entityId: lineId, parentEntityType: "Invoice", parentEntityId: id });
  });
}

export async function deleteDraft(ctx: Ctx, id: string) {
  await ctx.db.$transaction(async (tx) => {
    await draftForEdit(ctx, tx, id);
    await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
    await tx.invoice.delete({ where: { id } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "invoice.draft_deleted", entityType: "Invoice", entityId: id });
  });
}

// ───────── Issue (INV-01, ONB-01, ZAT-01/02) ─────────

type Seller = { legalNameEn: string; legalNameAr: string | null; vatNumber: string | null; vatRegistered: boolean; crNumber: string | null; address: Record<string, string | null>; country: string };

async function sellerSnapshot(tx: TenantTx, tenantId: string): Promise<Seller> {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const missing = [
    ["legalNameEn", t.legalNameEn], ["addressStreet", t.addressStreet], ["addressCity", t.addressCity], ["addressBuilding", t.addressBuilding], ["addressPostalCode", t.addressPostalCode],
  ].filter(([, v]) => !v).map(([k]) => k as string);
  if (t.vatRegistered && !t.vatNumber) missing.push("vatNumber");
  if (missing.length)
    throw new AppError(422, "AGENCY_PROFILE_INCOMPLETE", "Complete the agency legal details and address before issuing invoices", missing.map((m) => ({ path: m, code: "required", message: m })));
  return {
    legalNameEn: t.legalNameEn, legalNameAr: t.legalNameAr, vatNumber: t.vatNumber, vatRegistered: t.vatRegistered, crNumber: t.crNumber, country: t.country,
    address: { building: t.addressBuilding, street: t.addressStreet, district: t.addressDistrict, city: t.addressCity, postalCode: t.addressPostalCode, additionalNumber: t.addressAdditionalNumber },
  };
}

/** Number, ICV, UUID, QR and snapshots; shared by invoices and credit notes. */
async function stamp(tx: TenantTx, ctx: Ctx, inv: { id: string; kind: "INVOICE" | "CREDIT_NOTE"; total: Money; taxAmount: Money; currency: string }, seller: Seller, extra: Prisma.InvoiceUncheckedUpdateInput) {
  const issuedAt = new Date();
  const number = await nextDocumentNumber(tx, ctx.tenant.id, inv.kind === "INVOICE" ? "INVOICE" : "CREDIT_NOTE", issuedAt);
  const icv = await nextSequenceValue(tx, ctx.tenant.id, "ICV", 0); // invoice counter value, gapless across invoices and credit notes
  const qrPayload = zatcaQr({
    sellerName: seller.legalNameAr || seller.legalNameEn,
    vatNumber: seller.vatNumber ?? "",
    timestamp: issuedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    total: inv.total.toFixed(2),
    vatTotal: inv.taxAmount.toFixed(2),
  });
  await tx.invoice.update({
    where: { id: inv.id },
    data: { ...extra, status: "ISSUED", number, issuedAt, icv, zatcaUuid: randomUUID(), qrPayload, sellerSnapshot: seller as unknown as Prisma.InputJsonValue, issuedById: ctx.user.id },
  });
  await enqueue(tx, "pdf.render", { kind: "INVOICE", id: inv.id }, { tenantId: ctx.tenant.id, dedupeKey: `pdf:INVOICE:${inv.id}` });
  return { number, icv };
}

export async function issueInvoice(ctx: Ctx, id: string) {
  return ctx.db.$transaction(async (tx) => {
    const inv = await draftForEdit(ctx, tx, id);
    const lines = await tx.invoiceLine.findMany({ where: { invoiceId: id } });
    if (!lines.length) throw unprocessable("NO_LINES", "Add at least one line");
    const seller = await sellerSnapshot(tx, ctx.tenant.id);
    if (!seller.vatRegistered && lines.some((l) => !l.taxAmount.isZero()))
      throw unprocessable("TAX_WITHOUT_REGISTRATION", "The agency is not VAT registered; remove VAT from the lines");
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: inv.customerId } });
    // INV-06: standard (B2B) tax invoices need the buyer's VAT number and address.
    if (inv.type === "STANDARD" && (!customer.vatNumber || !customer.address))
      throw unprocessable("BUYER_DETAILS_REQUIRED", "Standard tax invoices need the customer's VAT number and address");
    // INV-02: each service is invoiced once (net of credit notes); the booking lock serializes concurrent issues.
    const itemIds = lines.map((l) => l.bookingItemId).filter((x): x is string => !!x);
    if (inv.bookingId) await lockBooking(tx, ctx.tenant.id, inv.bookingId);
    if (itemIds.length) {
      const already = await tx.bookingItem.count({ where: { id: { in: itemIds }, OR: [{ invoicedQuantity: { gt: 0 } }, { status: { in: ["CANCELLED", "FAILED"] } }] } });
      if (already) throw conflict("ALREADY_INVOICED", "A service on this invoice was already invoiced or cancelled");
      await tx.bookingItem.updateMany({ where: { id: { in: itemIds } }, data: { invoicedQuantity: { increment: 1 } } });
    }
    const terms = customer.paymentTermsDays;
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const booking = inv.bookingId ? await tx.booking.findUniqueOrThrow({ where: { id: inv.bookingId }, select: { travelStartDate: true } }) : null;
    const res = await stamp(tx, ctx, inv, seller, {
      supplyDate: inv.supplyDate ?? booking?.travelStartDate ?? today,
      dueDate: new Date(today.getTime() + terms * 86_400_000),
      customerSnapshot: { name: customer.displayName, nameAr: customer.nameAr, vatNumber: customer.vatNumber, crNumber: customer.crNumber, address: customer.address, phone: customer.phone, email: customer.email } as Prisma.InputJsonValue,
    });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "invoice.issued", entityType: "Invoice", entityId: id, changes: { status: ["DRAFT", "ISSUED"] }, metadata: { number: res.number, icv: res.icv, total: inv.total.toString(), type: inv.type } });
    return { id, ...res };
  });
}

// ───────── Credit notes (INV-07, INV-09) ─────────

export async function issueCreditNote(ctx: Ctx, invoiceId: string, input: z.infer<typeof creditNoteSchema>) {
  authorize(ctx, "creditnote:issue");
  return ctx.db.$transaction(async (tx) => {
    const original = await loadInvoice(ctx, tx, invoiceId);
    await lockInvoices(tx, ctx.tenant.id, [invoiceId]);
    if (original.status !== "ISSUED" || original.kind !== "INVOICE") throw conflict("NOT_CREDITABLE", "Only issued invoices can be credited");
    const lines = await tx.invoiceLine.findMany({ where: { invoiceId }, include: { creditLines: true } });
    const seller = await sellerSnapshot(tx, ctx.tenant.id);
    const cn = await tx.invoice.create({
      data: {
        tenantId: ctx.tenant.id, kind: "CREDIT_NOTE", type: original.type, customerId: original.customerId, branchId: original.branchId, bookingId: original.bookingId,
        originalId: original.id, reason: input.reason, currency: original.currency, exchangeRate: original.exchangeRate, pricesIncludeTax: original.pricesIncludeTax,
        customerSnapshot: original.customerSnapshot as Prisma.InputJsonValue, supplyDate: original.supplyDate, createdById: ctx.user.id,
      },
    });
    const fullyCreditedItems: string[] = [];
    for (const [n, req] of input.lines.entries()) {
      const line = lines.find((l) => l.id === req.originalLineId);
      if (!line) throw unprocessable("INVALID_LINE", "Unknown invoice line", `lines.${n}.originalLineId`);
      const remaining = line.totalAmount.minus(sum(line.creditLines.map((c) => c.totalAmount)));
      const amount = round(D(req.amount), original.currency);
      if (amount.greaterThan(remaining)) throw unprocessable("CREDIT_EXCEEDS_LINE", `At most ${remaining.toFixed(2)} can be credited on this line`, `lines.${n}.amount`);
      // Split the credited gross amount into net and tax in the line's own proportion.
      const tax = line.totalAmount.isZero() ? D(0) : round(line.taxAmount.times(amount).dividedBy(line.totalAmount), original.currency);
      await tx.invoiceLine.create({
        data: {
          tenantId: ctx.tenant.id, invoiceId: cn.id, originalLineId: line.id, bookingItemId: line.bookingItemId, descriptionEn: line.descriptionEn, descriptionAr: line.descriptionAr,
          quantity: 1, unitPrice: str(amount.minus(tax)), discount: 0, taxRateId: line.taxRateId, taxRateSnapshot: line.taxRateSnapshot as Prisma.InputJsonValue,
          netAmount: str(amount.minus(tax)), taxAmount: str(tax), totalAmount: str(amount), sortOrder: n,
        },
      });
      if (amount.equals(remaining) && line.bookingItemId) fullyCreditedItems.push(line.bookingItemId);
    }
    await refreshTotals(tx, cn.id);
    const fresh = await tx.invoice.findUniqueOrThrow({ where: { id: cn.id } });
    const res = await stamp(tx, ctx, fresh, seller, {});
    await tx.invoice.update({ where: { id: invoiceId }, data: { amountCredited: original.amountCredited.plus(fresh.total) } });
    // A fully credited service can be invoiced again (e.g. after an amendment).
    if (fullyCreditedItems.length) await tx.bookingItem.updateMany({ where: { id: { in: fullyCreditedItems }, invoicedQuantity: { gt: 0 } }, data: { invoicedQuantity: { decrement: 1 } } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "credit_note.issued", entityType: "Invoice", entityId: cn.id, parentEntityType: "Invoice", parentEntityId: invoiceId, metadata: { number: res.number, total: fresh.total.toString(), reason: input.reason } });
    return { id: cn.id, ...res, total: fresh.total.toString() };
  });
}

/** Email an issued invoice with its PDF to the customer (or the contact who receives invoices). */
export async function sendInvoice(ctx: Ctx, id: string) {
  authorize(ctx, "invoice:issue");
  const inv = await loadInvoice(ctx, ctx.db, id);
  if (inv.status !== "ISSUED") throw conflict("INVOICE_NOT_ISSUED", "Issue the invoice first");
  const customer = await ctx.db.customer.findUniqueOrThrow({ where: { id: inv.customerId }, include: { contacts: { where: { receivesInvoices: true, email: { not: null } } } } });
  const to = customer.contacts[0]?.email ?? customer.email;
  if (!to) throw unprocessable("NO_CUSTOMER_EMAIL", "The customer has no email address");
  await enqueue(ctx.db, "document.email", { kind: "INVOICE", id, to, locale: customer.preferredLocale, userId: ctx.user.id }, { tenantId: ctx.tenant.id });
  await audit(ctx.db, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "invoice.sent", entityType: "Invoice", entityId: id, metadata: { to } });
  return { queued: true, to };
}
