import type { TenantTx } from "@/server/db";
import { authorize, type Ctx } from "@/server/context";
import { unprocessable } from "@/server/errors";
import { D, round, sum } from "@/server/money";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
export const today = () => new Date().toISOString().slice(0, 10);
export const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const toDay = day;

/** CUR-03/04: latest manual rate on or before the date; 1 for the base currency. */
export async function rateToBase(tx: TenantTx, from: string, base: string, onDate = today()): Promise<string> {
  if (from === base) return "1";
  const r = await tx.exchangeRate.findFirst({ where: { fromCurrency: from, toCurrency: base, effectiveDate: { lte: day(onDate) } }, orderBy: { effectiveDate: "desc" } });
  if (!r) throw unprocessable("NO_EXCHANGE_RATE", `Add an exchange rate ${from} → ${base} first`, "currency");
  return r.rate.toString();
}

/** Branch-only scope for records without an owner (invoices, payments, expenses): OWN behaves like BRANCH. */
export function branchScope(ctx: Ctx, permission: Parameters<typeof authorize>[1]): { branchId?: { in: string[] } } {
  return authorize(ctx, permission) === "ALL" ? {} : { branchId: { in: ctx.membership.branchIds } };
}

/** INV: amountPaid of an invoice = sum of its active allocations. */
export async function refreshInvoicePaid(tx: TenantTx, invoiceId: string) {
  const a = await tx.paymentAllocation.aggregate({ where: { invoiceId, releasedAt: null }, _sum: { amount: true } });
  await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: a._sum.amount ?? 0 } });
}

/** §8.1: booking paid total = recorded payments for the booking − refunds paid for it. */
export async function refreshBookingPaid(tx: TenantTx, bookingId: string) {
  const [p, r, b] = await Promise.all([
    tx.payment.aggregate({ where: { bookingId, status: "RECORDED" }, _sum: { amount: true } }),
    tx.refund.aggregate({ where: { bookingId, status: "PAID" }, _sum: { amount: true } }),
    tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { grandTotal: true, currency: true } }),
  ]);
  const paid = round(D(p._sum.amount ?? 0).minus(D(r._sum.amount ?? 0)), b.currency);
  await tx.booking.update({ where: { id: bookingId }, data: { paidTotal: paid, balance: b.grandTotal.minus(paid), version: { increment: 1 } } });
}

/**
 * CRM-05: customer balance per currency, always computed from documents, never stored.
 * balance > 0: the customer owes; balance < 0: the customer has credit (overpaid or credited).
 */
export async function customerBalances(tx: TenantTx, customerId: string) {
  const [inv, cn, pay, ref] = await Promise.all([
    tx.invoice.groupBy({ by: ["currency"], where: { customerId, status: "ISSUED", kind: "INVOICE" }, _sum: { total: true } }),
    tx.invoice.groupBy({ by: ["currency"], where: { customerId, status: "ISSUED", kind: "CREDIT_NOTE" }, _sum: { total: true } }),
    tx.payment.groupBy({ by: ["currency"], where: { customerId, status: "RECORDED" }, _sum: { amount: true } }),
    tx.refund.groupBy({ by: ["currency"], where: { customerId, status: { in: ["APPROVED", "PAID"] } }, _sum: { amount: true } }),
  ]);
  const currencies = new Set([...inv, ...cn, ...pay, ...ref].map((x) => x.currency));
  const total = (rows: { currency: string; _sum: { total: unknown } }[], c: string) => D((rows.find((r) => r.currency === c)?._sum.total as string) ?? 0);
  const amount = (rows: { currency: string; _sum: { amount: unknown } }[], c: string) => D((rows.find((r) => r.currency === c)?._sum.amount as string) ?? 0);
  return [...currencies].map((c) => {
    const invoiced = total(inv, c), credited = total(cn, c), paid = amount(pay, c), refunded = amount(ref, c);
    return { currency: c, invoiced, credited, paid, refunded, balance: sum([invoiced, refunded]).minus(credited).minus(paid) };
  });
}

/** REF-02: what can still be refunded in a currency (approved-but-unpaid refunds already count as used). */
export async function refundable(tx: TenantTx, customerId: string, currency: string) {
  const b = (await customerBalances(tx, customerId)).find((x) => x.currency === currency);
  return b && b.balance.isNegative() ? b.balance.negated() : D(0);
}
