import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, tenantDb, type TenantTx } from "@/server/db";
import { audit, diff } from "@/server/audit";
import { authorize, can, type Ctx } from "@/server/context";
import { env } from "@/server/env";
import { AppError, conflict, forbidden, notFound, unprocessable } from "@/server/errors";
import { after, page } from "@/server/pagination";
import { assertBranchAllowed, assertWritable, inScope, scopeWhere } from "@/server/scope";
import { enqueue } from "@/server/jobs";
import { createLink, verifyLink } from "@/server/signed-links";
import { nextDocumentNumber } from "@/modules/tenancy/service";
import { recalc, resolveItem } from "@/modules/bookings/service";
import { sum } from "@/server/money";
import { needsApproval, totals } from "@/modules/bookings/rules";
import { isoDate, rateToBase, toDay, today } from "@/modules/finance/common";
import { bookingItemSchema, type BookingItemInput, type itemChangesSchema } from "@/lib/schemas-travel";
import type { quotationAcceptSchema, quotationCreateSchema, quotationRejectSchema, quotationUpdateSchema } from "@/lib/schemas-finance";
import type { listQuery } from "@/lib/schemas";

// §10 quotations: priced offers, not reservations (QT-04). Versions share one number (QT-01).

const PROPOSAL_TTL_DAYS = 60;

async function loadQuotation(ctx: Ctx, db: TenantTx, id: string) {
  const q = await db.quotation.findFirst({ where: { id, ...scopeWhere(ctx, "quotation:read") } });
  if (!q) throw notFound();
  return q;
}

/** Visible + in write scope; `draft` also requires the quotation to still be editable. */
async function writable(ctx: Ctx, tx: TenantTx, id: string, opts: { draft?: boolean } = {}) {
  const q = await loadQuotation(ctx, tx, id);
  assertWritable(ctx, "quotation:write", q);
  if (opts.draft && q.status !== "DRAFT") throw conflict("QUOTATION_NOT_DRAFT", "Only drafts can be edited; revise the quotation to change it");
  return q;
}

function checkVersion(q: { version: number }, version: number) {
  if (q.version !== version) throw new AppError(409, "VERSION_CONFLICT", "This quotation was changed by someone else", [], {}, { currentVersion: q.version });
}

async function recalcQuotation(tx: TenantTx, tenantId: string, id: string, priceChanged: boolean) {
  const q = await tx.quotation.findUniqueOrThrow({ where: { id }, include: { items: true } });
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { discountApprovalPercent: true } });
  const t = totals({ inclusive: q.pricesIncludeTax, currency: q.currency, items: q.items.map((i) => ({ ...i, status: "CONFIRMED" as const })), amendments: [] });
  const discountTotal = sum(q.items.map((i) => i.discountAmount));
  await tx.quotation.update({
    where: { id },
    data: {
      ...t,
      discountTotal,
      requiresApproval: needsApproval(q.items, tenant.discountApprovalPercent),
      ...(priceChanged ? { approvedAt: null, approvedById: null } : {}), // QT-10: price changes invalidate approval
      version: { increment: 1 },
    },
  });
}

// ───────── Reads ─────────

export async function listQuotations(ctx: Ctx, q: z.infer<typeof listQuery> & { status?: string; customerId?: string }) {
  const rows = await ctx.db.quotation.findMany({
    where: {
      ...scopeWhere(ctx, "quotation:read"),
      ...(q.status ? { status: q.status as never } : { status: { not: "SUPERSEDED" } }),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.q ? { OR: [{ number: { contains: q.q, mode: "insensitive" } }, { customer: { displayName: { contains: q.q, mode: "insensitive" } } }] } : {}),
      ...after(q.cursor, "createdAt", "desc"),
    },
    select: { id: true, number: true, versionNo: true, status: true, validUntil: true, currency: true, grandTotal: true, createdAt: true, customer: { select: { id: true, displayName: true } }, requiresApproval: true, approvedAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  const p = page(rows, q.limit, (r) => r.createdAt);
  return { ...p, data: p.data.map((r) => ({ ...r, validUntil: isoDate(r.validUntil) })) };
}

export async function getQuotation(ctx: Ctx, id: string) {
  const q = await ctx.db.quotation.findFirst({
    where: { id, ...scopeWhere(ctx, "quotation:read") },
    include: {
      items: { orderBy: { sortOrder: "asc" }, include: { supplier: { select: { nameEn: true, nameAr: true } } } },
      customer: { select: { id: true, code: true, displayName: true, email: true, preferredLocale: true } },
      owner: { select: { user: { select: { name: true } } } },
      booking: { select: { id: true, reference: true } },
    },
  });
  if (!q) throw notFound();
  const rootId = q.rootId ?? q.id;
  const versions = await ctx.db.quotation.findMany({ where: { OR: [{ id: rootId }, { rootId }] }, orderBy: { versionNo: "asc" }, select: { id: true, versionNo: true, status: true } });
  const w = can(ctx, "quotation:write") && inScope(ctx, "quotation:write", q);
  const margin = can(ctx, "report:financial") || q.ownerId === ctx.membership.id;
  return {
    ...q,
    validUntil: isoDate(q.validUntil),
    costTotal: margin ? q.costTotal : null,
    items: q.items.map((i) => ({ ...i, startDate: isoDate(i.startDate), endDate: isoDate(i.endDate), costAmount: margin ? i.costAmount : null })),
    versions,
    permissions: {
      edit: w && q.status === "DRAFT",
      approve: q.status === "DRAFT" && q.requiresApproval && !q.approvedAt && can(ctx, "quotation:approve-discount") && inScope(ctx, "quotation:approve-discount", q),
      send: w && q.status === "DRAFT",
      decide: w && q.status === "SENT",
      revise: w && ["SENT", "EXPIRED", "REJECTED"].includes(q.status),
      convert: w && q.status === "ACCEPTED" && can(ctx, "booking:write"),
      margin,
    },
  };
}

// ───────── Drafts ─────────

export async function createQuotation(ctx: Ctx, input: z.infer<typeof quotationCreateSchema>) {
  authorize(ctx, "quotation:write");
  const customer = await ctx.db.customer.findFirst({ where: { id: input.customerId, mergedIntoId: null, archivedAt: null, ...scopeWhere(ctx, "customer:read") } });
  if (!customer) throw unprocessable("INVALID_CUSTOMER", "Customer not found", "customerId");
  const branchId = input.branchId ?? ctx.membership.primaryBranchId;
  assertBranchAllowed(ctx, "quotation:write", branchId);
  return ctx.db.$transaction(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { baseCurrency: true, enabledCurrencies: true, pricesIncludeTax: true, quotationValidityDays: true } });
    const currency = input.currency ?? t.baseCurrency;
    if (!t.enabledCurrencies.includes(currency)) throw unprocessable("CURRENCY_NOT_ENABLED", "This currency is not enabled", "currency");
    const validUntil = input.validUntil ?? new Date(Date.now() + t.quotationValidityDays * 86_400_000).toISOString().slice(0, 10);
    if (validUntil < today()) throw unprocessable("VALIDITY_IN_PAST", "The validity date is in the past", "validUntil");
    const q = await tx.quotation.create({
      data: {
        tenantId: ctx.tenant.id, customerId: customer.id, branchId, ownerId: ctx.membership.id, currency, exchangeRate: await rateToBase(tx, currency, t.baseCurrency),
        pricesIncludeTax: t.pricesIncludeTax, validUntil: toDay(validUntil), showItemPrices: input.showItemPrices, notes: input.notes ?? null, customerNotes: input.customerNotes ?? null, createdById: ctx.user.id,
      },
    });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "quotation.created", entityType: "Quotation", entityId: q.id, metadata: { customerId: customer.id, currency } });
    return { id: q.id };
  });
}

export async function updateQuotation(ctx: Ctx, id: string, input: z.infer<typeof quotationUpdateSchema>) {
  return ctx.db.$transaction(async (tx) => {
    const q = await writable(ctx, tx, id, { draft: true });
    checkVersion(q, input.version);
    if (input.validUntil < today()) throw unprocessable("VALIDITY_IN_PAST", "The validity date is in the past", "validUntil");
    const data = { validUntil: toDay(input.validUntil), showItemPrices: input.showItemPrices, notes: input.notes ?? null, customerNotes: input.customerNotes ?? null, termsEn: input.termsEn ?? null, termsAr: input.termsAr ?? null };
    await tx.quotation.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
    const changes = diff(q, data);
    if (changes) await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "quotation.updated", entityType: "Quotation", entityId: id, changes });
  });
}

function itemRow(data: Awaited<ReturnType<typeof resolveItem>>) {
  const { supplierConfirmation: _c, pnr: _p, ...rest } = data;
  return rest;
}

export async function addQuotationItem(ctx: Ctx, id: string, input: BookingItemInput) {
  return ctx.db.$transaction(async (tx) => {
    const q = await writable(ctx, tx, id, { draft: true });
    const data = itemRow(await resolveItem(ctx, tx, q, input));
    const item = await tx.quotationItem.create({ data: { ...data, tenantId: ctx.tenant.id, quotationId: id, sortOrder: await tx.quotationItem.count({ where: { quotationId: id } }) } as Prisma.QuotationItemUncheckedCreateInput });
    await recalcQuotation(tx, ctx.tenant.id, id, true);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "quotation_item.created", entityType: "QuotationItem", entityId: item.id, parentEntityType: "Quotation", parentEntityId: id });
    return { id: item.id };
  });
}

export async function updateQuotationItem(ctx: Ctx, id: string, itemId: string, changes: z.infer<typeof itemChangesSchema>) {
  return ctx.db.$transaction(async (tx) => {
    const q = await writable(ctx, tx, id, { draft: true });
    const i = await tx.quotationItem.findFirst({ where: { id: itemId, quotationId: id } });
    if (!i) throw notFound();
    const merged = {
      serviceType: i.serviceType, description: i.description, supplierId: i.supplierId, productId: i.productId, startDate: isoDate(i.startDate), endDate: isoDate(i.endDate), quantity: i.quantity,
      costAmount: i.costAmount.toString(), sellAmount: i.sellAmount.toString(), commissionAmount: i.commissionAmount.toString(), serviceFeeAmount: i.serviceFeeAmount.toString(),
      discountAmount: i.discountAmount.toString(), taxRateId: i.taxRateId, taxBasis: i.taxBasis, pricingModel: i.pricingModel, details: i.details, ...changes,
    };
    if ((i.serviceType === "FLIGHT" || i.serviceType === "HOTEL") && changes.details) Object.assign(merged, { startDate: null, endDate: null });
    const parsed = bookingItemSchema.safeParse(merged);
    if (!parsed.success) throw new AppError(422, "VALIDATION_FAILED", "Validation failed", parsed.error.issues.map((x) => ({ path: x.path.join("."), code: x.code, message: x.message })));
    const data = itemRow(await resolveItem(ctx, tx, q, parsed.data));
    await tx.quotationItem.update({ where: { id: itemId }, data: data as Prisma.QuotationItemUncheckedUpdateInput });
    await recalcQuotation(tx, ctx.tenant.id, id, true);
    const changed = diff(i, data as Record<string, unknown>);
    if (changed) await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "quotation_item.updated", entityType: "QuotationItem", entityId: itemId, parentEntityType: "Quotation", parentEntityId: id, changes: changed });
  });
}

export async function removeQuotationItem(ctx: Ctx, id: string, itemId: string) {
  return ctx.db.$transaction(async (tx) => {
    await writable(ctx, tx, id, { draft: true });
    await tx.quotationItem.delete({ where: { id: itemId, quotationId: id } });
    await recalcQuotation(tx, ctx.tenant.id, id, true);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "quotation_item.deleted", entityType: "QuotationItem", entityId: itemId, parentEntityType: "Quotation", parentEntityId: id });
  });
}

// ───────── Approval, sending, decisions (QT-05..12) ─────────

export async function approveQuotation(ctx: Ctx, id: string) {
  return ctx.db.$transaction(async (tx) => {
    const q = await loadQuotation(ctx, tx, id);
    if (!can(ctx, "quotation:approve-discount") || !inScope(ctx, "quotation:approve-discount", q)) throw forbidden();
    if (q.status !== "DRAFT") throw conflict("QUOTATION_NOT_DRAFT", "Only drafts are approved");
    if (!q.requiresApproval) throw unprocessable("APPROVAL_NOT_NEEDED", "This quotation needs no approval");
    await tx.quotation.update({ where: { id }, data: { approvedAt: new Date(), approvedById: ctx.user.id, version: { increment: 1 } } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "quotation.discount_approved", entityType: "Quotation", entityId: id, metadata: { grandTotal: q.grandTotal.toString(), discountTotal: q.discountTotal.toString() } });
  });
}

/** QT-06: email it (needs a configured email provider and the customer's email) or record that it was shared otherwise. */
export async function sendQuotation(ctx: Ctx, id: string, manual: boolean) {
  return ctx.db.$transaction(async (tx) => {
    const q = await writable(ctx, tx, id, { draft: true });
    if (!(await tx.quotationItem.count({ where: { quotationId: id } }))) throw unprocessable("NO_ITEMS", "Add at least one service");
    if (q.requiresApproval && !q.approvedAt) throw unprocessable("APPROVAL_REQUIRED", "A manager must approve the discount or below-cost price first");
    if (isoDate(q.validUntil)! < today()) throw unprocessable("VALIDITY_IN_PAST", "The validity date is in the past", "validUntil");
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: q.customerId } });
    if (!manual && !customer.email) throw unprocessable("NO_CUSTOMER_EMAIL", "The customer has no email address; share it another way and record it as sent");
    const number = q.number ?? (await nextDocumentNumber(tx, ctx.tenant.id, "QUOTATION"));
    await tx.quotation.update({ where: { id }, data: { number, status: "SENT", sentAt: new Date(), version: { increment: 1 } } });
    const { token } = createLink("proposal", ctx.tenant.id, id, PROPOSAL_TTL_DAYS);
    const link = `${env().APP_URL}/proposal/${token}`;
    if (!manual) await enqueue(tx, "document.email", { kind: "QUOTATION", id, to: customer.email, locale: customer.preferredLocale, link, userId: ctx.user.id }, { tenantId: ctx.tenant.id });
    else await tx.interaction.create({ data: { tenantId: ctx.tenant.id, customerId: q.customerId, channel: "OTHER", direction: "OUT", subject: `${number} v${q.versionNo}`, body: "Quotation shared outside the system", occurredAt: new Date(), userId: ctx.user.id } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: manual ? "quotation.marked_sent" : "quotation.sent", entityType: "Quotation", entityId: id, changes: { status: ["DRAFT", "SENT"] }, metadata: { number, versionNo: q.versionNo } });
    return { id, number, link, emailQueued: !manual };
  });
}

/** QT-01: a sent (or expired / rejected) quotation changes through a new version with the same number. */
export async function reviseQuotation(ctx: Ctx, id: string) {
  return ctx.db.$transaction(async (tx) => {
    const q = await writable(ctx, tx, id);
    if (!["SENT", "EXPIRED", "REJECTED"].includes(q.status)) throw conflict("NOT_REVISABLE", "Only sent, expired or rejected quotations are revised");
    const rootId = q.rootId ?? q.id;
    const last = await tx.quotation.aggregate({ where: { OR: [{ id: rootId }, { rootId }] }, _max: { versionNo: true } });
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { quotationValidityDays: true } });
    const validUntil = isoDate(q.validUntil)! >= today() ? q.validUntil : toDay(new Date(Date.now() + t.quotationValidityDays * 86_400_000).toISOString().slice(0, 10));
    const { id: _id, createdAt: _c, updatedAt: _u, sentAt: _s, acceptedAt: _a, acceptanceNote: _n, lostReason: _lr, lostNote: _ln, status: _st, version: _v, versionNo: _vn, rootId: _r, approvedAt: _ap, approvedById: _ab, ...copy } = q;
    const next = await tx.quotation.create({ data: { ...copy, rootId, versionNo: (last._max.versionNo ?? 1) + 1, status: "DRAFT", validUntil, createdById: ctx.user.id } });
    const items = await tx.quotationItem.findMany({ where: { quotationId: id } });
    for (const { id: _iid, createdAt: _ic, quotationId: _q, ...i } of items)
      await tx.quotationItem.create({ data: { ...i, quotationId: next.id, details: i.details as Prisma.InputJsonValue, taxRateSnapshot: (i.taxRateSnapshot ?? undefined) as Prisma.InputJsonValue | undefined } });
    await tx.quotation.update({ where: { id }, data: { status: "SUPERSEDED", version: { increment: 1 } } });
    await recalcQuotation(tx, ctx.tenant.id, next.id, true);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "quotation.revised", entityType: "Quotation", entityId: next.id, metadata: { from: id, number: q.number, versionNo: next.versionNo } });
    return { id: next.id, versionNo: next.versionNo };
  });
}

export async function acceptQuotation(ctx: Ctx, id: string, input: z.infer<typeof quotationAcceptSchema>) {
  return ctx.db.$transaction(async (tx) => {
    const q = await writable(ctx, tx, id);
    checkVersion(q, input.version);
    if (q.status !== "SENT") throw conflict("INVALID_STATE_TRANSITION", "Only sent quotations can be accepted");
    if (isoDate(q.validUntil)! < today()) throw unprocessable("QUOTATION_EXPIRED", "This quotation has expired; revise it");
    await tx.quotation.update({ where: { id }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptanceNote: input.note ?? null, version: { increment: 1 } } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "quotation.accepted", entityType: "Quotation", entityId: id, changes: { status: ["SENT", "ACCEPTED"] } });
  });
}

export async function rejectQuotation(ctx: Ctx, id: string, input: z.infer<typeof quotationRejectSchema>) {
  return ctx.db.$transaction(async (tx) => {
    const q = await writable(ctx, tx, id);
    checkVersion(q, input.version);
    if (q.status !== "SENT") throw conflict("INVALID_STATE_TRANSITION", "Only sent quotations can be rejected");
    await tx.quotation.update({ where: { id }, data: { status: "REJECTED", lostReason: input.lostReason, lostNote: input.lostNote ?? null, version: { increment: 1 } } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "quotation.rejected", entityType: "Quotation", entityId: id, changes: { status: ["SENT", "REJECTED"] }, metadata: { lostReason: input.lostReason } });
  });
}

/** QT-03: an accepted quotation becomes a draft booking once (unique quotationId), with its services copied. */
export async function convertQuotation(ctx: Ctx, id: string) {
  authorize(ctx, "booking:write");
  return ctx.db.$transaction(async (tx) => {
    const q = await writable(ctx, tx, id);
    if (q.status !== "ACCEPTED") throw conflict(q.status === "CONVERTED" ? "ALREADY_CONVERTED" : "INVALID_STATE_TRANSITION", "Only accepted quotations are converted, once");
    assertBranchAllowed(ctx, "booking:write", q.branchId);
    const reference = await nextDocumentNumber(tx, ctx.tenant.id, "BOOKING");
    const b = await tx.booking.create({
      data: {
        tenantId: ctx.tenant.id, reference, customerId: q.customerId, branchId: q.branchId, ownerId: ctx.membership.id, quotationId: q.id, currency: q.currency, exchangeRate: q.exchangeRate,
        pricesIncludeTax: q.pricesIncludeTax, notes: q.notes, customerNotes: q.customerNotes, createdById: ctx.user.id,
        // An approved discount stays approved for the booking made from it.
        approvedAt: q.approvedAt, approvedById: q.approvedById,
      },
    });
    const items = await tx.quotationItem.findMany({ where: { quotationId: id }, orderBy: { sortOrder: "asc" } });
    for (const { id: _iid, createdAt: _c, quotationId: _q, ...i } of items)
      await tx.bookingItem.create({ data: { ...i, bookingId: b.id, details: i.details as Prisma.InputJsonValue, taxRateSnapshot: (i.taxRateSnapshot ?? undefined) as Prisma.InputJsonValue | undefined } });
    await tx.bookingStatusHistory.create({ data: { tenantId: ctx.tenant.id, bookingId: b.id, toStatus: "DRAFT", reason: `from quotation ${q.number} v${q.versionNo}`, userId: ctx.user.id } });
    await recalc(tx, ctx.tenant.id, b.id, ctx.actor);
    await tx.quotation.update({ where: { id }, data: { status: "CONVERTED", version: { increment: 1 } } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "quotation.converted", entityType: "Quotation", entityId: id, metadata: { bookingId: b.id, reference } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking.created", entityType: "Booking", entityId: b.id, metadata: { reference, fromQuotation: id } });
    return { bookingId: b.id, reference };
  });
}

export async function quotationLink(ctx: Ctx, id: string) {
  const q = await loadQuotation(ctx, ctx.db, id);
  if (q.status === "DRAFT") throw unprocessable("QUOTATION_NOT_SENT", "Send the quotation first");
  const { token, expiresAt } = createLink("proposal", ctx.tenant.id, id, PROPOSAL_TTL_DAYS);
  return { url: `${env().APP_URL}/proposal/${token}`, expiresAt };
}

/** QT-05 customer view: no costs, no margins, no internal notes. */
export async function publicProposal(token: string) {
  const link = verifyLink("proposal", token);
  if (!link) return null;
  const db = tenantDb(link.tenantId);
  const q = await db.quotation.findFirst({ where: { id: link.id, status: { not: "DRAFT" } }, include: { items: { orderBy: { sortOrder: "asc" } }, customer: { select: { displayName: true } } } });
  if (!q) return null;
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: link.tenantId }, select: { legalNameEn: true, legalNameAr: true, tradeNameEn: true, tradeNameAr: true, phone: true, email: true, primaryColor: true, quotationTermsEn: true, quotationTermsAr: true } });
  return {
    agency: tenant,
    number: q.number, versionNo: q.versionNo, status: q.status, validUntil: isoDate(q.validUntil)!, customer: q.customer.displayName, currency: q.currency, showItemPrices: q.showItemPrices,
    customerNotes: q.customerNotes, termsEn: q.termsEn ?? tenant.quotationTermsEn, termsAr: q.termsAr ?? tenant.quotationTermsAr,
    items: q.items.map((i) => ({ serviceType: i.serviceType, description: i.description, startDate: isoDate(i.startDate)!, endDate: isoDate(i.endDate)!, price: q.showItemPrices ? i.sellAmount.plus(i.serviceFeeAmount).minus(i.discountAmount).toString() : null })),
    totals: { sell: q.sellTotal.toString(), tax: q.taxTotal.toString(), grand: q.grandTotal.toString() },
  };
}

/** QT-02 nightly: sent quotations past their validity become EXPIRED (all tenants). */
export async function expireQuotations() {
  const due = await prisma.quotation.findMany({ where: { status: "SENT", validUntil: { lt: toDay(today()) } }, select: { id: true, tenantId: true } });
  for (const q of due)
    await tenantDb(q.tenantId).$transaction(async (tx) => {
      const r = await tx.quotation.updateMany({ where: { id: q.id, status: "SENT" }, data: { status: "EXPIRED", version: { increment: 1 } } });
      if (r.count) await audit(tx, { tenantId: q.tenantId, actor: { type: "SYSTEM", id: null }, action: "quotation.expired", entityType: "Quotation", entityId: q.id, changes: { status: ["SENT", "EXPIRED"] } });
    });
  return due.length;
}
