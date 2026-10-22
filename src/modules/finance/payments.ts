import type { z } from "zod";
import type { TenantTx } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, can, type Ctx } from "@/server/context";
import { conflict, forbidden, notFound, unprocessable } from "@/server/errors";
import { after, page } from "@/server/pagination";
import { D, round, str, sum } from "@/server/money";
import { scopeWhere } from "@/server/scope";
import { enqueue } from "@/server/jobs";
import { lockCustomer, lockInvoices, lockPayment } from "@/server/db/raw/finance";
import { nextDocumentNumber } from "@/modules/tenancy/service";
import { branchScope, isoDate, rateToBase, refreshBookingPaid, refreshInvoicePaid, refundable, toDay } from "./common";
import type { allocationSchema, paymentSchema, refundPaidSchema, refundRequestSchema } from "@/lib/schemas-finance";
import type { listQuery } from "@/lib/schemas";

// "finance:approve" in the spec (PAY-04, REF-01, FIN-08) is the refund:approve permission of §4.7.
const APPROVE = "refund:approve" as const;

async function activeAccount(tx: TenantTx, id: string, currency: string) {
  const a = await tx.financialAccount.findFirst({ where: { id, active: true } });
  if (!a) throw unprocessable("INVALID_ACCOUNT", "Account not found", "financialAccountId");
  if (a.currency !== currency) throw unprocessable("ACCOUNT_CURRENCY", `This account holds ${a.currency}`, "financialAccountId");
  return a;
}

/**
 * PAY-01/03: allocate inside the caller's transaction. Invoices are row-locked so concurrent payments cannot
 * push an invoice past its outstanding amount.
 */
async function allocate(ctx: Ctx, tx: TenantTx, payment: { id: string; customerId: string; currency: string; amount: ReturnType<typeof D> }, allocations: z.infer<typeof allocationSchema>[]) {
  if (!allocations.length) return;
  const ids = [...new Set(allocations.map((a) => a.invoiceId))];
  if (ids.length !== allocations.length) throw unprocessable("DUPLICATE_ALLOCATION", "Each invoice appears once", "allocations");
  await lockInvoices(tx, ctx.tenant.id, ids);
  const existing = await tx.paymentAllocation.aggregate({ where: { paymentId: payment.id, releasedAt: null }, _sum: { amount: true } });
  if (D(existing._sum.amount ?? 0).plus(sum(allocations.map((a) => D(a.amount)))).greaterThan(payment.amount))
    throw unprocessable("OVER_ALLOCATED", "Allocations exceed the payment amount", "allocations");
  for (const [n, a] of allocations.entries()) {
    const inv = await tx.invoice.findFirst({ where: { id: a.invoiceId } });
    if (!inv || inv.status !== "ISSUED" || inv.kind !== "INVOICE" || inv.customerId !== payment.customerId) throw unprocessable("INVALID_INVOICE", "Choose an issued invoice of this customer", `allocations.${n}.invoiceId`);
    if (inv.currency !== payment.currency) throw unprocessable("CURRENCY_MISMATCH", "The invoice is in another currency", `allocations.${n}.invoiceId`);
    const outstanding = inv.total.minus(inv.amountCredited).minus(inv.amountPaid);
    if (D(a.amount).greaterThan(outstanding)) throw unprocessable("EXCEEDS_OUTSTANDING", `At most ${outstanding.toFixed(2)} is outstanding on ${inv.number}`, `allocations.${n}.amount`);
    await tx.paymentAllocation.create({ data: { tenantId: ctx.tenant.id, paymentId: payment.id, invoiceId: inv.id, amount: a.amount } });
    await refreshInvoicePaid(tx, inv.id);
  }
}

export async function listPayments(ctx: Ctx, q: z.infer<typeof listQuery> & { customerId?: string; bookingId?: string }) {
  authorize(ctx, "invoice:read");
  const rows = await ctx.db.payment.findMany({
    where: {
      ...branchScope(ctx, "invoice:read"),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.bookingId ? { bookingId: q.bookingId } : {}),
      ...(q.q ? { OR: [{ number: { contains: q.q, mode: "insensitive" } }, { reference: { contains: q.q, mode: "insensitive" } }, { customer: { displayName: { contains: q.q, mode: "insensitive" } } }] } : {}),
      ...after(q.cursor, "createdAt", "desc"),
    },
    include: { customer: { select: { id: true, displayName: true } }, booking: { select: { id: true, reference: true } }, allocations: { where: { releasedAt: null }, include: { invoice: { select: { id: true, number: true } } } }, financialAccount: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  const p = page(rows, q.limit, (r) => r.createdAt);
  return { ...p, data: p.data.map((r) => ({ ...r, date: isoDate(r.date), unallocated: r.status === "RECORDED" ? r.amount.minus(sum(r.allocations.map((a) => a.amount))) : D(0) })) };
}

export async function recordPayment(ctx: Ctx, input: z.infer<typeof paymentSchema>) {
  authorize(ctx, "payment:record");
  const customer = await ctx.db.customer.findFirst({ where: { id: input.customerId, ...scopeWhere(ctx, "customer:read") } });
  if (!customer) throw unprocessable("INVALID_CUSTOMER", "Customer not found", "customerId");
  return ctx.db.$transaction(async (tx) => {
    await lockCustomer(tx, ctx.tenant.id, customer.id);
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { baseCurrency: true } });
    let bookingId = input.bookingId ?? null;
    let branchId = customer.branchId;
    let currency = input.currency ?? t.baseCurrency;
    if (bookingId) {
      const b = await tx.booking.findFirst({ where: { id: bookingId, customerId: customer.id } });
      if (!b) throw unprocessable("INVALID_BOOKING", "Booking not found for this customer", "bookingId");
      currency = b.currency;
      branchId = b.branchId;
    } else if (input.allocations.length) {
      // Payment for invoices of one booking counts towards that booking.
      const bookings = await tx.invoice.findMany({ where: { id: { in: input.allocations.map((a) => a.invoiceId) } }, select: { bookingId: true, currency: true, branchId: true } });
      if (bookings.length && bookings.every((x) => x.bookingId && x.bookingId === bookings[0].bookingId)) bookingId = bookings[0].bookingId;
      if (bookings.length) [currency, branchId] = [bookings[0].currency, bookings[0].branchId];
    }
    if (branchScope(ctx, "payment:record").branchId && !ctx.membership.branchIds.includes(branchId)) throw forbidden();
    await activeAccount(tx, input.financialAccountId, currency);
    const rate = await rateToBase(tx, currency, t.baseCurrency, input.date);
    const number = await nextDocumentNumber(tx, ctx.tenant.id, "RECEIPT");
    const p = await tx.payment.create({
      data: {
        tenantId: ctx.tenant.id, number, customerId: customer.id, branchId, bookingId, date: toDay(input.date), amount: input.amount, currency, exchangeRate: rate,
        baseAmount: str(round(D(input.amount).times(rate), t.baseCurrency)), method: input.method, reference: input.reference ?? null,
        financialAccountId: input.financialAccountId, notes: input.notes ?? null, createdById: ctx.user.id,
      },
    });
    await allocate(ctx, tx, { id: p.id, customerId: customer.id, currency, amount: D(input.amount) }, input.allocations);
    if (bookingId) await refreshBookingPaid(tx, bookingId);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "payment.recorded", entityType: "Payment", entityId: p.id, metadata: { number, amount: input.amount, currency, method: input.method, allocations: input.allocations } });
    await enqueue(tx, "pdf.render", { kind: "RECEIPT", id: p.id, userId: ctx.user.id }, { tenantId: ctx.tenant.id, dedupeKey: `pdf:RECEIPT:${p.id}` }); // PAY-07
    return { id: p.id, number };
  });
}

/** Apply unallocated payment credit (e.g. a deposit) to an invoice later (PAY-02). */
export async function allocateExisting(ctx: Ctx, paymentId: string, input: z.infer<typeof allocationSchema>) {
  authorize(ctx, "payment:record");
  return ctx.db.$transaction(async (tx) => {
    const p = await tx.payment.findFirst({ where: { id: paymentId, ...branchScope(ctx, "payment:record") } });
    if (!p) throw notFound();
    await lockPayment(tx, ctx.tenant.id, "payment", paymentId);
    if (p.status !== "RECORDED") throw conflict("PAYMENT_REVERSED", "This payment was reversed");
    await allocate(ctx, tx, p, [input]);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "payment.allocated", entityType: "Payment", entityId: paymentId, metadata: input });
  });
}

/** PAY-04: a recorded payment is never edited; it is reversed (approval permission, reason) and its allocations released. */
export async function reversePayment(ctx: Ctx, id: string, reason: string) {
  authorize(ctx, APPROVE);
  return ctx.db.$transaction(async (tx) => {
    const p = await tx.payment.findFirst({ where: { id, ...branchScope(ctx, APPROVE) } });
    if (!p) throw notFound();
    await lockPayment(tx, ctx.tenant.id, "payment", id);
    if (p.status !== "RECORDED") throw conflict("PAYMENT_REVERSED", "This payment was already reversed");
    const allocs = await tx.paymentAllocation.findMany({ where: { paymentId: id, releasedAt: null } });
    await lockInvoices(tx, ctx.tenant.id, allocs.map((a) => a.invoiceId));
    await tx.paymentAllocation.updateMany({ where: { paymentId: id, releasedAt: null }, data: { releasedAt: new Date() } });
    for (const a of allocs) await refreshInvoicePaid(tx, a.invoiceId);
    await tx.payment.update({ where: { id }, data: { status: "REVERSED", reversedAt: new Date(), reversedById: ctx.user.id, reversalReason: reason } });
    if (p.bookingId) await refreshBookingPaid(tx, p.bookingId);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "payment.reversed", entityType: "Payment", entityId: id, changes: { status: ["RECORDED", "REVERSED"] }, metadata: { reason, released: allocs.length } });
  });
}

// ───────── Refunds (§11.5) ─────────

/** Visible refunds: everything, the user's branches (via the customer), or the ones they requested (OWN). */
function refundScope(ctx: Ctx) {
  const scope = authorize(ctx, "refund:request");
  if (scope === "ALL" || can(ctx, APPROVE)) return {};
  if (scope === "BRANCH") return { customer: { branchId: { in: ctx.membership.branchIds } } };
  return { requestedById: ctx.user.id };
}

export async function listRefunds(ctx: Ctx, q: z.infer<typeof listQuery> & { status?: string }) {
  const rows = await ctx.db.refund.findMany({
    where: { ...refundScope(ctx), ...(q.status ? { status: q.status as never } : {}), ...after(q.cursor, "createdAt", "desc") },
    include: { customer: { select: { id: true, displayName: true } }, booking: { select: { id: true, reference: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  const p = page(rows, q.limit, (r) => r.createdAt);
  return { ...p, data: p.data.map((r) => ({ ...r, paidAt: isoDate(r.paidAt) })) };
}

export async function requestRefund(ctx: Ctx, input: z.infer<typeof refundRequestSchema>) {
  authorize(ctx, "refund:request");
  const customer = await ctx.db.customer.findFirst({ where: { id: input.customerId, ...scopeWhere(ctx, "customer:read") } });
  if (!customer) throw unprocessable("INVALID_CUSTOMER", "Customer not found", "customerId");
  return ctx.db.$transaction(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { baseCurrency: true } });
    let currency = input.currency ?? t.baseCurrency;
    if (input.bookingId) {
      const b = await tx.booking.findFirst({ where: { id: input.bookingId, customerId: customer.id } });
      if (!b) throw unprocessable("INVALID_BOOKING", "Booking not found for this customer", "bookingId");
      currency = b.currency;
    }
    if (input.creditNoteId && !(await tx.invoice.count({ where: { id: input.creditNoteId, kind: "CREDIT_NOTE", status: "ISSUED", customerId: customer.id } })))
      throw unprocessable("INVALID_CREDIT_NOTE", "Credit note not found for this customer", "creditNoteId");
    const available = await refundable(tx, customer.id, currency);
    if (D(input.amount).greaterThan(available)) throw unprocessable("EXCEEDS_CREDIT", `The customer has ${available.toFixed(2)} ${currency} of credit`, "amount");
    const number = await nextDocumentNumber(tx, ctx.tenant.id, "REFUND");
    const r = await tx.refund.create({
      data: { tenantId: ctx.tenant.id, number, customerId: customer.id, bookingId: input.bookingId ?? null, creditNoteId: input.creditNoteId ?? null, amount: input.amount, currency, method: input.method, reason: input.reason, requestedById: ctx.user.id },
    });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "refund.requested", entityType: "Refund", entityId: r.id, metadata: { number, amount: input.amount, currency } });
    return { id: r.id, number };
  });
}

async function refundFor(ctx: Ctx, tx: TenantTx, id: string) {
  const r = await tx.refund.findFirst({ where: { id, ...refundScope(ctx) } });
  if (!r) throw notFound();
  return r;
}

/** REF-01/02: approver ≠ requester (unless the agency allows self-approval); amount re-checked against credit now. */
export async function approveRefund(ctx: Ctx, id: string, note: string | null | undefined) {
  authorize(ctx, APPROVE);
  return ctx.db.$transaction(async (tx) => {
    const r = await refundFor(ctx, tx, id);
    await lockCustomer(tx, ctx.tenant.id, r.customerId);
    const fresh = await tx.refund.findUniqueOrThrow({ where: { id } });
    if (fresh.status !== "REQUESTED") throw conflict("INVALID_STATE_TRANSITION", "Only requested refunds are approved");
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { refundSelfApproval: true } });
    if (fresh.requestedById === ctx.user.id && !t.refundSelfApproval) throw unprocessable("SELF_APPROVAL", "Another approver must approve your own refund request");
    // The refund itself is not counted yet (status REQUESTED), so `available` is the credit before it.
    const available = await refundable(tx, fresh.customerId, fresh.currency);
    if (fresh.amount.greaterThan(available)) throw unprocessable("EXCEEDS_CREDIT", `The customer has ${available.toFixed(2)} ${fresh.currency} of credit`, "amount");
    await tx.refund.update({ where: { id }, data: { status: "APPROVED", approvedById: ctx.user.id, approvedAt: new Date(), decisionNote: note ?? null } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "refund.approved", entityType: "Refund", entityId: id, changes: { status: ["REQUESTED", "APPROVED"] } });
  });
}

export async function rejectRefund(ctx: Ctx, id: string, note: string | null | undefined) {
  authorize(ctx, APPROVE);
  return ctx.db.$transaction(async (tx) => {
    const r = await refundFor(ctx, tx, id);
    if (r.status !== "REQUESTED") throw conflict("INVALID_STATE_TRANSITION", "Only requested refunds are rejected");
    await tx.refund.update({ where: { id }, data: { status: "REJECTED", approvedById: ctx.user.id, approvedAt: new Date(), decisionNote: note ?? null } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "refund.rejected", entityType: "Refund", entityId: id, changes: { status: ["REQUESTED", "REJECTED"] } });
  });
}

export async function cancelRefund(ctx: Ctx, id: string) {
  return ctx.db.$transaction(async (tx) => {
    const r = await refundFor(ctx, tx, id);
    if (r.requestedById !== ctx.user.id && !can(ctx, APPROVE)) throw forbidden();
    if (r.status !== "REQUESTED" && r.status !== "APPROVED") throw conflict("INVALID_STATE_TRANSITION", "This refund can no longer be cancelled");
    await tx.refund.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "refund.cancelled", entityType: "Refund", entityId: id, changes: { status: [r.status, "CANCELLED"] } });
  });
}

/** REF-03: records how and when the money left. Gateway refunds will go through the gateway adapter (Phase 6). */
export async function markRefundPaid(ctx: Ctx, id: string, input: z.infer<typeof refundPaidSchema>) {
  authorize(ctx, APPROVE);
  return ctx.db.$transaction(async (tx) => {
    const r = await refundFor(ctx, tx, id);
    if (r.status !== "APPROVED") throw conflict("INVALID_STATE_TRANSITION", "Only approved refunds are paid");
    await activeAccount(tx, input.financialAccountId, r.currency);
    await tx.refund.update({ where: { id }, data: { status: "PAID", paidAt: toDay(input.paidAt), financialAccountId: input.financialAccountId, reference: input.reference ?? null } });
    if (r.bookingId) await refreshBookingPaid(tx, r.bookingId);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "refund.paid", entityType: "Refund", entityId: id, changes: { status: ["APPROVED", "PAID"] }, metadata: { paidAt: input.paidAt } });
  });
}
