import type { z } from "zod";
import { authorize, type Ctx } from "@/server/context";
import { notFound, unprocessable } from "@/server/errors";
import { D, round, sum, type Money } from "@/server/money";
import { scopeWhere } from "@/server/scope";
import { customerPrice, itemMargin } from "@/modules/bookings/rules";
import { accountBalances } from "./payables";
import { isoDate, toDay } from "./common";
import type { REPORTS, reportQuery } from "@/lib/schemas-finance";

// §11.9 operational reports. Amounts are in the base currency using each document's snapshot rate (CUR-04).
// These are operational figures, not statutory statements (§12.1).

type Q = z.infer<typeof reportQuery>;
const end = (to: string) => new Date(toDay(to).getTime() + 86_400_000); // exclusive upper bound for timestamps
const b2 = (v: Money) => round(v, "SAR").toFixed(2);

function branchFilter(ctx: Ctx, q: Q) {
  const scope = authorize(ctx, "report:financial");
  if (q.branchId) {
    if (scope !== "ALL" && !ctx.membership.branchIds.includes(q.branchId)) throw unprocessable("INVALID_BRANCH", "Not one of your branches", "branchId");
    return { branchId: q.branchId };
  }
  return scope === "ALL" ? {} : { branchId: { in: ctx.membership.branchIds } };
}

function group<T>(rows: T[], key: (r: T) => string, value: (r: T) => Money) {
  const m = new Map<string, Money>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? D(0)).plus(value(r)));
  return [...m.entries()].map(([k, v]) => ({ key: k, amount: b2(v) })).sort((a, b) => Number(b.amount) - Number(a.amount));
}

async function issued(ctx: Ctx, q: Q) {
  return ctx.db.invoice.findMany({
    where: { status: "ISSUED", issuedAt: { gte: toDay(q.from), lt: end(q.to) }, ...branchFilter(ctx, q) },
    include: { customer: { select: { displayName: true } }, branch: { select: { code: true } }, lines: { include: { bookingItem: { select: { serviceType: true } } } } },
  });
}
const sign = (i: { kind: string }) => (i.kind === "CREDIT_NOTE" ? -1 : 1);
const base = (v: Money, rate: Money, s = 1) => v.times(rate).times(s);

export async function runReport(ctx: Ctx, name: (typeof REPORTS)[number], q: Q) {
  authorize(ctx, "report:financial");
  const bf = branchFilter(ctx, q);
  switch (name) {
    case "sales": {
      const inv = await issued(ctx, q);
      const lines = inv.flatMap((i) => i.lines.map((l) => ({ i, l })));
      return {
        totals: {
          invoiced: b2(sum(inv.filter((i) => i.kind === "INVOICE").map((i) => base(i.taxableAmount, i.exchangeRate)))),
          credited: b2(sum(inv.filter((i) => i.kind === "CREDIT_NOTE").map((i) => base(i.taxableAmount, i.exchangeRate)))),
          net: b2(sum(inv.map((i) => base(i.taxableAmount, i.exchangeRate, sign(i))))),
          vat: b2(sum(inv.map((i) => base(i.taxAmount, i.exchangeRate, sign(i))))),
          documents: inv.length,
        },
        byMonth: group(inv, (i) => i.issuedAt!.toISOString().slice(0, 7), (i) => base(i.taxableAmount, i.exchangeRate, sign(i))).sort((a, b) => a.key.localeCompare(b.key)),
        byBranch: group(inv, (i) => i.branch.code, (i) => base(i.taxableAmount, i.exchangeRate, sign(i))),
        byServiceType: group(lines, ({ l }) => l.bookingItem?.serviceType ?? "OTHER", ({ i, l }) => base(l.netAmount, i.exchangeRate, sign(i))),
        byCustomer: group(inv, (i) => i.customer.displayName, (i) => base(i.taxableAmount, i.exchangeRate, sign(i))).slice(0, 20),
      };
    }
    case "margin": {
      const items = await ctx.db.bookingItem.findMany({
        where: { status: { notIn: ["CANCELLED", "FAILED"] }, booking: { status: { not: "CANCELLED" }, createdAt: { gte: toDay(q.from), lt: end(q.to) }, ...scopeWhere(ctx, "booking:read"), ...bf } },
        include: { booking: { select: { exchangeRate: true, pricesIncludeTax: true } }, supplier: { select: { nameEn: true } } },
      });
      const net = (i: (typeof items)[number]) => (i.booking.pricesIncludeTax ? customerPrice(i).minus(i.taxAmount) : customerPrice(i));
      const row = (rows: typeof items) => ({
        sell: b2(sum(rows.map((i) => base(net(i), i.booking.exchangeRate)))),
        cost: b2(sum(rows.map((i) => base(i.costAmount, i.booking.exchangeRate)))),
        commission: b2(sum(rows.map((i) => base(i.commissionAmount, i.booking.exchangeRate)))),
        margin: b2(sum(rows.map((i) => base(itemMargin({ ...i, sellAmount: i.booking.pricesIncludeTax ? i.sellAmount.minus(i.taxAmount) : i.sellAmount }), i.booking.exchangeRate)))),
      });
      const by = (key: (i: (typeof items)[number]) => string) => [...new Set(items.map(key))].map((k) => ({ key: k, ...row(items.filter((i) => key(i) === k)) })).sort((a, b) => Number(b.margin) - Number(a.margin));
      return { totals: row(items), byServiceType: by((i) => i.serviceType), bySupplier: by((i) => i.supplier?.nameEn ?? "—") };
    }
    case "ar-aging": {
      const asOf = q.asOf ?? q.to;
      const inv = await ctx.db.invoice.findMany({ where: { status: "ISSUED", kind: "INVOICE", issuedAt: { lt: end(asOf) }, ...bf }, include: { customer: { select: { id: true, displayName: true } } } });
      return aging(asOf, inv.map((i) => ({ party: i.customer.displayName, partyId: i.customer.id, due: i.dueDate ?? i.issuedAt!, outstanding: base(i.total.minus(i.amountCredited).minus(i.amountPaid), i.exchangeRate) })));
    }
    case "ap-aging": {
      const asOf = q.asOf ?? q.to;
      const bills = await ctx.db.supplierBill.findMany({ where: { status: "RECORDED", billDate: { lte: toDay(asOf) } }, include: { supplier: { select: { id: true, nameEn: true } } } });
      return aging(asOf, bills.map((b) => ({ party: b.supplier.nameEn, partyId: b.supplier.id, due: b.dueDate ?? b.billDate, outstanding: base(b.total.minus(b.amountPaid), b.exchangeRate) })));
    }
    case "cash": {
      const range = { gte: toDay(q.from), lte: toDay(q.to) };
      const [accounts, pay, ref, sup, exp] = await Promise.all([
        accountBalances(ctx.db),
        ctx.db.payment.groupBy({ by: ["financialAccountId"], where: { status: "RECORDED", date: range }, _sum: { amount: true } }),
        ctx.db.refund.groupBy({ by: ["financialAccountId"], where: { status: "PAID", paidAt: range }, _sum: { amount: true } }),
        ctx.db.supplierPayment.groupBy({ by: ["financialAccountId"], where: { status: "RECORDED", date: range }, _sum: { amount: true } }),
        ctx.db.expense.groupBy({ by: ["financialAccountId"], where: { status: "RECORDED", date: range }, _sum: { amount: true } }),
      ]);
      const of = (rows: { financialAccountId: string | null; _sum: { amount: unknown } }[], id: string) => (D((rows.find((r) => r.financialAccountId === id)?._sum.amount as string) ?? 0)).toFixed(2);
      return { accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, currency: a.currency, balance: a.balance.toFixed(2), receipts: of(pay, a.id), refunds: of(ref, a.id), supplierPayments: of(sup, a.id), expenses: of(exp, a.id) })) };
    }
    case "payments": {
      const pays = await ctx.db.payment.findMany({ where: { status: "RECORDED", date: { gte: toDay(q.from), lte: toDay(q.to) }, ...bf }, include: { financialAccount: { select: { name: true } } } });
      return { total: b2(sum(pays.map((p) => p.baseAmount))), count: pays.length, byMethod: group(pays, (p) => p.method, (p) => p.baseAmount), byAccount: group(pays, (p) => p.financialAccount.name, (p) => p.baseAmount) };
    }
    case "expenses": {
      const ex = await ctx.db.expense.findMany({ where: { status: "RECORDED", date: { gte: toDay(q.from), lte: toDay(q.to) }, ...bf }, include: { category: true, branch: { select: { code: true } } } });
      return { total: b2(sum(ex.map((e) => e.baseAmount))), count: ex.length, byCategory: group(ex, (e) => e.category.nameEn, (e) => e.baseAmount), byBranch: group(ex, (e) => e.branch.code, (e) => e.baseAmount) };
    }
    case "vat": {
      const inv = await issued(ctx, q);
      const lines = inv.flatMap((i) => i.lines.map((l) => ({ i, l, s: l.taxRateSnapshot as { category: string; zatcaCode: string; rate: string } })));
      const [bills, exps] = await Promise.all([
        ctx.db.supplierBill.findMany({ where: { status: "RECORDED", billDate: { gte: toDay(q.from), lte: toDay(q.to) } } }),
        ctx.db.expense.findMany({ where: { status: "RECORDED", date: { gte: toDay(q.from), lte: toDay(q.to) }, ...bf } }),
      ]);
      const cats = [...new Set(lines.map((x) => `${x.s.zatcaCode}|${x.s.category}|${x.s.rate}`))];
      const output = cats.map((c) => {
        const [code, category, rate] = c.split("|");
        const rows = lines.filter((x) => `${x.s.zatcaCode}|${x.s.category}|${x.s.rate}` === c);
        return { code, category, rate, taxable: b2(sum(rows.map(({ i, l }) => base(l.netAmount, i.exchangeRate, sign(i))))), vat: b2(sum(rows.map(({ i, l }) => base(l.taxAmount, i.exchangeRate, sign(i))))) };
      });
      const outputVat = sum(output.map((o) => D(o.vat)));
      const inputVat = sum([...bills.map((b) => base(b.taxAmount, b.exchangeRate)), ...exps.map((e) => base(e.taxAmount, e.exchangeRate))]);
      // Supports, does not replace, the VAT return (§11.9).
      return { output, outputVat: b2(outputVat), inputVat: b2(inputVat), net: b2(outputVat.minus(inputVat)) };
    }
    case "profit": {
      const [inv, bills, exps] = await Promise.all([
        issued(ctx, q),
        ctx.db.supplierBill.findMany({ where: { status: "RECORDED", billDate: { gte: toDay(q.from), lte: toDay(q.to) } } }),
        ctx.db.expense.findMany({ where: { status: "RECORDED", date: { gte: toDay(q.from), lte: toDay(q.to) }, ...bf } }),
      ]);
      const sales = sum(inv.map((i) => base(i.taxableAmount, i.exchangeRate, sign(i))));
      const supplierCost = sum(bills.map((b) => base(b.subtotal, b.exchangeRate)));
      const expenses = sum(exps.map((e) => base(e.amount.minus(e.taxAmount), e.exchangeRate)));
      return { sales: b2(sales), supplierCost: b2(supplierCost), grossMargin: b2(sales.minus(supplierCost)), expenses: b2(expenses), operatingResult: b2(sales.minus(supplierCost).minus(expenses)) };
    }
  }
}

function aging(asOf: string, rows: { party: string; partyId: string; due: Date; outstanding: Money }[]) {
  const buckets = ["current", "d1_30", "d31_60", "d61_90", "d90plus"] as const;
  const bucket = (due: Date) => {
    const days = Math.floor((toDay(asOf).getTime() - toDay(due.toISOString().slice(0, 10)).getTime()) / 86_400_000);
    return days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90plus";
  };
  const open = rows.filter((r) => r.outstanding.greaterThan(0));
  const parties = [...new Set(open.map((r) => r.partyId))].map((id) => {
    const mine = open.filter((r) => r.partyId === id);
    return { partyId: id, party: mine[0].party, ...Object.fromEntries(buckets.map((b) => [b, b2(sum(mine.filter((r) => bucket(r.due) === b).map((r) => r.outstanding)))])), total: b2(sum(mine.map((r) => r.outstanding))) };
  });
  return { asOf, buckets, parties: parties.sort((a, b) => Number(b.total) - Number(a.total)), totals: Object.fromEntries([...buckets, "total"].map((b) => [b, b2(sum(parties.map((p) => D((p as Record<string, string>)[b]))))])) };
}

// ───────── Statements (§11.9, SUP-05) ─────────

type Line = { date: string; kind: string; number: string; debit: string; credit: string; balance?: string };

function running(opening: Money, lines: Omit<Line, "balance">[]) {
  let bal = opening;
  return lines
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => {
      bal = bal.plus(D(l.debit)).minus(D(l.credit));
      return { ...l, balance: bal.toFixed(2) };
    });
}

/** Customer statement in one currency: debit = invoices + paid refunds, credit = credit notes + payments. */
export async function customerStatement(ctx: Ctx, customerId: string, from: string, to: string, currency: string) {
  authorize(ctx, "invoice:read");
  const c = await ctx.db.customer.findFirst({ where: { id: customerId, ...scopeWhere(ctx, "customer:read") } });
  if (!c) throw notFound();
  const [inv, pay, ref] = await Promise.all([
    ctx.db.invoice.findMany({ where: { customerId, currency, status: "ISSUED", issuedAt: { lt: end(to) } } }),
    ctx.db.payment.findMany({ where: { customerId, currency, status: "RECORDED", date: { lte: toDay(to) } } }),
    ctx.db.refund.findMany({ where: { customerId, currency, status: "PAID", paidAt: { lte: toDay(to) } } }),
  ]);
  const rows: (Omit<Line, "balance"> & { before: boolean })[] = [
    ...inv.map((i) => ({ date: isoDate(i.issuedAt)!, kind: i.kind, number: i.number!, debit: i.kind === "INVOICE" ? i.total.toFixed(2) : "0", credit: i.kind === "CREDIT_NOTE" ? i.total.toFixed(2) : "0" })),
    ...pay.map((p) => ({ date: isoDate(p.date)!, kind: "PAYMENT", number: p.number, debit: "0", credit: p.amount.toFixed(2) })),
    ...ref.map((r) => ({ date: isoDate(r.paidAt)!, kind: "REFUND", number: r.number, debit: r.amount.toFixed(2), credit: "0" })),
  ].map((r) => ({ ...r, before: r.date < from }));
  const opening = sum(rows.filter((r) => r.before).map((r) => D(r.debit).minus(D(r.credit))));
  const lines = running(opening, rows.filter((r) => !r.before).map(({ before: _b, ...r }) => r));
  return { customer: { id: c.id, code: c.code, name: c.displayName }, currency, from, to, opening: opening.toFixed(2), lines, closing: (lines.at(-1)?.balance ?? opening.toFixed(2)) };
}

/** SUP-05: debit = what we owe (bills), credit = what we paid. */
export async function supplierStatement(ctx: Ctx, supplierId: string, from: string, to: string, currency: string) {
  authorize(ctx, "supplier:read");
  const s = await ctx.db.supplier.findUnique({ where: { id: supplierId } });
  if (!s) throw notFound();
  const [bills, pays] = await Promise.all([
    ctx.db.supplierBill.findMany({ where: { supplierId, currency, status: "RECORDED", billDate: { lte: toDay(to) } } }),
    ctx.db.supplierPayment.findMany({ where: { supplierId, currency, status: "RECORDED", date: { lte: toDay(to) } } }),
  ]);
  const rows = [
    ...bills.map((b) => ({ date: isoDate(b.billDate)!, kind: "BILL", number: b.supplierInvoiceNumber, debit: b.total.toFixed(2), credit: "0" })),
    ...pays.map((p) => ({ date: isoDate(p.date)!, kind: "PAYMENT", number: p.number, debit: "0", credit: p.amount.toFixed(2) })),
  ];
  const opening = sum(rows.filter((r) => r.date < from).map((r) => D(r.debit).minus(D(r.credit))));
  const lines = running(opening, rows.filter((r) => r.date >= from));
  return { supplier: { id: s.id, code: s.code, name: s.nameEn }, currency, from, to, opening: opening.toFixed(2), lines, closing: lines.at(-1)?.balance ?? opening.toFixed(2) };
}
