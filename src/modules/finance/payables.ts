import type { z } from "zod";
import type { TenantTx } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { conflict, notFound, unprocessable } from "@/server/errors";
import { after, page } from "@/server/pagination";
import { D, round, str, sum } from "@/server/money";
import { encrypt, last4, mask } from "@/server/crypto";
import { lockBills, lockPayment } from "@/server/db/raw/finance";
import { nextDocumentNumber } from "@/modules/tenancy/service";
import { branchScope, isoDate, rateToBase, toDay } from "./common";
import type { expenseSchema, financialAccountSchema, supplierBillSchema, supplierPaymentSchema, transferSchema } from "@/lib/schemas-finance";
import type { listQuery } from "@/lib/schemas";

const APPROVE = "refund:approve" as const; // spec's finance:approve (see payments.ts)
type List = z.infer<typeof listQuery>;

async function activeAccount(tx: TenantTx, id: string, currency: string) {
  const a = await tx.financialAccount.findFirst({ where: { id, active: true } });
  if (!a) throw unprocessable("INVALID_ACCOUNT", "Account not found", "financialAccountId");
  if (a.currency !== currency) throw unprocessable("ACCOUNT_CURRENCY", `This account holds ${a.currency}`, "financialAccountId");
  return a;
}

async function baseCurrency(tx: TenantTx, tenantId: string) {
  return (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { baseCurrency: true } })).baseCurrency;
}

// ───────── Supplier bills (§11.6, SUP-03/04) ─────────

export async function listBills(ctx: Ctx, q: List & { supplierId?: string; unpaid?: boolean }) {
  authorize(ctx, "supplier:read");
  const rows = await ctx.db.supplierBill.findMany({
    where: {
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.q ? { OR: [{ supplierInvoiceNumber: { contains: q.q, mode: "insensitive" } }, { supplier: { nameEn: { contains: q.q, mode: "insensitive" } } }] } : {}),
      ...after(q.cursor, "createdAt", "desc"),
    },
    include: { supplier: { select: { id: true, nameEn: true, nameAr: true } }, lines: { include: { bookingItem: { select: { id: true, description: true, costAmount: true, booking: { select: { id: true, reference: true } } } } } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  const p = page(rows, q.limit, (r) => r.createdAt);
  const data = p.data.map((b) => ({
    ...b,
    billDate: isoDate(b.billDate),
    dueDate: isoDate(b.dueDate),
    outstanding: b.status === "RECORDED" ? b.total.minus(b.amountPaid) : D(0),
    // SUP-03: billed vs committed cost per linked service.
    lines: b.lines.map((l) => ({ ...l, variance: l.bookingItem ? l.amount.minus(l.bookingItem.costAmount) : null })),
  }));
  return { ...p, data: q.unpaid ? data.filter((b) => b.outstanding.greaterThan(0)) : data };
}

export async function recordBill(ctx: Ctx, input: z.infer<typeof supplierBillSchema>) {
  authorize(ctx, "supplierbill:write");
  return ctx.db.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId } });
    if (!supplier) throw unprocessable("INVALID_SUPPLIER", "Supplier not found", "supplierId");
    const currency = input.currency ?? supplier.defaultCurrency;
    const itemIds = input.lines.map((l) => l.bookingItemId).filter((x): x is string => !!x);
    if (itemIds.length && (await tx.bookingItem.count({ where: { id: { in: itemIds } } })) !== new Set(itemIds).size) throw unprocessable("INVALID_ITEM", "Unknown booking service", "lines");
    const subtotal = round(sum(input.lines.map((l) => D(l.amount))), currency);
    const tax = round(sum(input.lines.map((l) => D(l.taxAmount))), currency);
    const total = subtotal.plus(tax);
    const base = await baseCurrency(tx, ctx.tenant.id);
    const rate = await rateToBase(tx, currency, base, input.billDate);
    const bill = await tx.supplierBill.create({
      data: {
        tenantId: ctx.tenant.id, supplierId: supplier.id, supplierInvoiceNumber: input.supplierInvoiceNumber, billDate: toDay(input.billDate), dueDate: input.dueDate ? toDay(input.dueDate) : new Date(toDay(input.billDate).getTime() + supplier.paymentTermsDays * 86_400_000),
        currency, exchangeRate: rate, subtotal: str(subtotal), taxAmount: str(tax), total: str(total), baseTotal: str(round(total.times(rate), base)), notes: input.notes ?? null, createdById: ctx.user.id,
        lines: { create: input.lines.map((l) => ({ description: l.description, bookingItemId: l.bookingItemId ?? null, amount: l.amount, taxAmount: l.taxAmount })) },
      },
    });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "supplier_bill.recorded", entityType: "SupplierBill", entityId: bill.id, parentEntityType: "Supplier", parentEntityId: supplier.id, metadata: { number: input.supplierInvoiceNumber, total: total.toString(), currency } });
    return { id: bill.id };
  });
}

export async function reverseBill(ctx: Ctx, id: string, reason: string) {
  authorize(ctx, APPROVE);
  return ctx.db.$transaction(async (tx) => {
    await lockBills(tx, ctx.tenant.id, [id]);
    const b = await tx.supplierBill.findUnique({ where: { id } });
    if (!b) throw notFound();
    if (b.status !== "RECORDED") throw conflict("ALREADY_REVERSED", "This bill was already reversed");
    if (!b.amountPaid.isZero()) throw unprocessable("BILL_HAS_PAYMENTS", "Reverse the payments on this bill first");
    await tx.supplierBill.update({ where: { id }, data: { status: "REVERSED", reversedAt: new Date(), reversedById: ctx.user.id, reversalReason: reason } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "supplier_bill.reversed", entityType: "SupplierBill", entityId: id, changes: { status: ["RECORDED", "REVERSED"] }, metadata: { reason } });
  });
}

// ───────── Supplier payments (FIN-06) ─────────

export async function listSupplierPayments(ctx: Ctx, q: List & { supplierId?: string }) {
  authorize(ctx, "supplier:read");
  const rows = await ctx.db.supplierPayment.findMany({
    where: { ...(q.supplierId ? { supplierId: q.supplierId } : {}), ...after(q.cursor, "createdAt", "desc") },
    include: { supplier: { select: { id: true, nameEn: true, nameAr: true } }, allocations: { where: { releasedAt: null }, include: { bill: { select: { id: true, supplierInvoiceNumber: true } } } }, financialAccount: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  const p = page(rows, q.limit, (r) => r.createdAt);
  return { ...p, data: p.data.map((r) => ({ ...r, date: isoDate(r.date), unallocated: r.status === "RECORDED" ? r.amount.minus(sum(r.allocations.map((a) => a.amount))) : D(0) })) };
}

async function refreshBillPaid(tx: TenantTx, billId: string) {
  const a = await tx.supplierPaymentAllocation.aggregate({ where: { billId, releasedAt: null }, _sum: { amount: true } });
  await tx.supplierBill.update({ where: { id: billId }, data: { amountPaid: a._sum.amount ?? 0 } });
}

export async function recordSupplierPayment(ctx: Ctx, input: z.infer<typeof supplierPaymentSchema>) {
  authorize(ctx, "supplierpayment:write");
  return ctx.db.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId } });
    if (!supplier) throw unprocessable("INVALID_SUPPLIER", "Supplier not found", "supplierId");
    const currency = input.currency ?? supplier.defaultCurrency;
    await activeAccount(tx, input.financialAccountId, currency);
    if (sum(input.allocations.map((a) => D(a.amount))).greaterThan(D(input.amount))) throw unprocessable("OVER_ALLOCATED", "Allocations exceed the payment amount", "allocations");
    const base = await baseCurrency(tx, ctx.tenant.id);
    const rate = await rateToBase(tx, currency, base, input.date);
    const number = await nextDocumentNumber(tx, ctx.tenant.id, "SUPPLIER_PAYMENT");
    const p = await tx.supplierPayment.create({
      data: {
        tenantId: ctx.tenant.id, number, supplierId: supplier.id, date: toDay(input.date), amount: input.amount, currency, exchangeRate: rate, baseAmount: str(round(D(input.amount).times(rate), base)),
        method: input.method, reference: input.reference ?? null, financialAccountId: input.financialAccountId, createdById: ctx.user.id,
      },
    });
    await lockBills(tx, ctx.tenant.id, input.allocations.map((a) => a.billId));
    for (const [n, a] of input.allocations.entries()) {
      const bill = await tx.supplierBill.findFirst({ where: { id: a.billId } });
      if (!bill || bill.supplierId !== supplier.id || bill.status !== "RECORDED") throw unprocessable("INVALID_BILL", "Choose a recorded bill of this supplier", `allocations.${n}.billId`);
      if (bill.currency !== currency) throw unprocessable("CURRENCY_MISMATCH", "The bill is in another currency", `allocations.${n}.billId`);
      if (D(a.amount).greaterThan(bill.total.minus(bill.amountPaid))) throw unprocessable("EXCEEDS_OUTSTANDING", `At most ${bill.total.minus(bill.amountPaid).toFixed(2)} is outstanding`, `allocations.${n}.amount`);
      await tx.supplierPaymentAllocation.create({ data: { tenantId: ctx.tenant.id, paymentId: p.id, billId: bill.id, amount: a.amount } });
      await refreshBillPaid(tx, bill.id);
    }
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "supplier_payment.recorded", entityType: "SupplierPayment", entityId: p.id, parentEntityType: "Supplier", parentEntityId: supplier.id, metadata: { number, amount: input.amount, currency } });
    return { id: p.id, number };
  });
}

export async function reverseSupplierPayment(ctx: Ctx, id: string, reason: string) {
  authorize(ctx, APPROVE);
  return ctx.db.$transaction(async (tx) => {
    await lockPayment(tx, ctx.tenant.id, "supplier_payment", id);
    const p = await tx.supplierPayment.findUnique({ where: { id } });
    if (!p) throw notFound();
    if (p.status !== "RECORDED") throw conflict("PAYMENT_REVERSED", "This payment was already reversed");
    const allocs = await tx.supplierPaymentAllocation.findMany({ where: { paymentId: id, releasedAt: null } });
    await lockBills(tx, ctx.tenant.id, allocs.map((a) => a.billId));
    await tx.supplierPaymentAllocation.updateMany({ where: { paymentId: id, releasedAt: null }, data: { releasedAt: new Date() } });
    for (const a of allocs) await refreshBillPaid(tx, a.billId);
    await tx.supplierPayment.update({ where: { id }, data: { status: "REVERSED", reversedAt: new Date(), reversedById: ctx.user.id, reversalReason: reason } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "supplier_payment.reversed", entityType: "SupplierPayment", entityId: id, changes: { status: ["RECORDED", "REVERSED"] }, metadata: { reason } });
  });
}

// ───────── Expenses (§11.7, FIN-08) ─────────

export async function listExpenses(ctx: Ctx, q: List & { status?: string }) {
  authorize(ctx, "expense:write");
  const rows = await ctx.db.expense.findMany({
    where: { ...branchScope(ctx, "expense:write"), ...(q.status ? { status: q.status as never } : {}), ...(q.q ? { description: { contains: q.q, mode: "insensitive" } } : {}), ...after(q.cursor, "createdAt", "desc") },
    include: { category: true, financialAccount: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  const p = page(rows, q.limit, (r) => r.createdAt);
  return { ...p, data: p.data.map((r) => ({ ...r, date: isoDate(r.date) })) };
}

export async function recordExpense(ctx: Ctx, input: z.infer<typeof expenseSchema>) {
  authorize(ctx, "expense:write");
  const branchId = input.branchId ?? ctx.membership.primaryBranchId;
  if (branchScope(ctx, "expense:write").branchId && !ctx.membership.branchIds.includes(branchId)) throw unprocessable("INVALID_BRANCH", "Choose one of your branches", "branchId");
  return ctx.db.$transaction(async (tx) => {
    if (!(await tx.expenseCategory.count({ where: { id: input.categoryId, active: true } }))) throw unprocessable("INVALID_CATEGORY", "Category not found", "categoryId");
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { baseCurrency: true, expenseApprovalLimit: true } });
    const currency = input.currency ?? t.baseCurrency;
    await activeAccount(tx, input.financialAccountId, currency);
    if (D(input.taxAmount).greaterThan(D(input.amount))) throw unprocessable("TAX_EXCEEDS_AMOUNT", "VAT cannot exceed the amount", "taxAmount");
    const rate = await rateToBase(tx, currency, t.baseCurrency, input.date);
    const baseAmount = round(D(input.amount).times(rate), t.baseCurrency);
    const status = baseAmount.greaterThan(t.expenseApprovalLimit) ? "PENDING_APPROVAL" : "RECORDED"; // FIN-08
    const number = await nextDocumentNumber(tx, ctx.tenant.id, "EXPENSE");
    const e = await tx.expense.create({
      data: {
        tenantId: ctx.tenant.id, number, date: toDay(input.date), branchId, categoryId: input.categoryId, description: input.description, amount: input.amount, taxAmount: input.taxAmount,
        currency, exchangeRate: rate, baseAmount: str(baseAmount), financialAccountId: input.financialAccountId, payee: input.payee ?? null, supplierId: input.supplierId ?? null,
        bookingId: input.bookingId ?? null, status, createdById: ctx.user.id,
      },
    });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "expense.recorded", entityType: "Expense", entityId: e.id, metadata: { number, amount: input.amount, currency, status } });
    return { id: e.id, number, status };
  });
}

export async function decideExpense(ctx: Ctx, id: string, approve: boolean) {
  authorize(ctx, APPROVE);
  return ctx.db.$transaction(async (tx) => {
    const e = await tx.expense.findFirst({ where: { id, ...branchScope(ctx, APPROVE) } });
    if (!e) throw notFound();
    if (e.status !== "PENDING_APPROVAL") throw conflict("INVALID_STATE_TRANSITION", "This expense is not waiting for approval");
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { refundSelfApproval: true } });
    if (e.createdById === ctx.user.id && !t.refundSelfApproval) throw unprocessable("SELF_APPROVAL", "Another approver must decide your own expense");
    const status = approve ? "RECORDED" : "REJECTED";
    await tx.expense.update({ where: { id }, data: { status, approvedById: ctx.user.id, approvedAt: new Date() } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: approve ? "expense.approved" : "expense.rejected", entityType: "Expense", entityId: id, changes: { status: ["PENDING_APPROVAL", status] } });
  });
}

export async function reverseExpense(ctx: Ctx, id: string, reason: string) {
  authorize(ctx, APPROVE);
  return ctx.db.$transaction(async (tx) => {
    const e = await tx.expense.findFirst({ where: { id, ...branchScope(ctx, APPROVE) } });
    if (!e) throw notFound();
    if (e.status !== "RECORDED") throw conflict("INVALID_STATE_TRANSITION", "Only recorded expenses are reversed");
    await tx.expense.update({ where: { id }, data: { status: "REVERSED", reversedAt: new Date(), reversedById: ctx.user.id, reversalReason: reason } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "expense.reversed", entityType: "Expense", entityId: id, changes: { status: ["RECORDED", "REVERSED"] }, metadata: { reason } });
  });
}

// ───────── Financial accounts and transfers (§11.8) ─────────

/** Balance = opening + receipts − refunds paid − supplier payments − expenses ± transfers; computed, never stored. */
export async function accountBalances(db: TenantTx) {
  const accounts = await db.financialAccount.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  const [pay, ref, sup, exp, tout, tin] = await Promise.all([
    db.payment.groupBy({ by: ["financialAccountId"], where: { status: "RECORDED" }, _sum: { amount: true } }),
    db.refund.groupBy({ by: ["financialAccountId"], where: { status: "PAID" }, _sum: { amount: true } }),
    db.supplierPayment.groupBy({ by: ["financialAccountId"], where: { status: "RECORDED" }, _sum: { amount: true } }),
    db.expense.groupBy({ by: ["financialAccountId"], where: { status: "RECORDED" }, _sum: { amount: true } }),
    db.accountTransfer.groupBy({ by: ["fromAccountId"], _sum: { amount: true, fee: true } }),
    db.accountTransfer.groupBy({ by: ["toAccountId"], _sum: { amount: true } }),
  ]);
  const get = (rows: { _sum: { amount: unknown } }[], match: (r: never) => boolean) => D((rows.find(match as never)?._sum.amount as string) ?? 0);
  return accounts.map((a) => {
    const out = tout.find((t) => t.fromAccountId === a.id);
    const balance = a.openingBalance
      .plus(get(pay, (r: { financialAccountId: string }) => r.financialAccountId === a.id))
      .minus(get(ref, (r: { financialAccountId: string | null }) => r.financialAccountId === a.id))
      .minus(get(sup, (r: { financialAccountId: string }) => r.financialAccountId === a.id))
      .minus(get(exp, (r: { financialAccountId: string }) => r.financialAccountId === a.id))
      .minus(D(out?._sum.amount ?? 0).plus(D(out?._sum.fee ?? 0)))
      .plus(get(tin, (r: { toAccountId: string }) => r.toAccountId === a.id));
    const { ibanEnc: _e, ...rest } = a;
    return { ...rest, iban: mask(a.ibanLast4), balance };
  });
}

export async function createAccount(ctx: Ctx, input: z.infer<typeof financialAccountSchema> & { iban?: string | null }) {
  authorize(ctx, "tenant:settings");
  return ctx.db.$transaction(async (tx) => {
    const a = await tx.financialAccount.create({
      data: { tenantId: ctx.tenant.id, name: input.name, type: input.type, currency: input.currency, branchId: input.branchId ?? null, openingBalance: input.openingBalance, ...(input.iban ? { ibanEnc: encrypt(input.iban), ibanLast4: last4(input.iban) } : {}) },
    });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "financial_account.created", entityType: "FinancialAccount", entityId: a.id, metadata: { name: a.name, type: a.type, currency: a.currency } });
    return { id: a.id };
  });
}

export async function transfer(ctx: Ctx, input: z.infer<typeof transferSchema>) {
  authorize(ctx, APPROVE);
  return ctx.db.$transaction(async (tx) => {
    const from = await tx.financialAccount.findFirst({ where: { id: input.fromAccountId, active: true } });
    const to = await tx.financialAccount.findFirst({ where: { id: input.toAccountId, active: true } });
    if (!from || !to) throw unprocessable("INVALID_ACCOUNT", "Account not found", !from ? "fromAccountId" : "toAccountId");
    if (from.currency !== to.currency) throw unprocessable("ACCOUNT_CURRENCY", "Both accounts must hold the same currency", "toAccountId");
    const t = await tx.accountTransfer.create({ data: { tenantId: ctx.tenant.id, fromAccountId: from.id, toAccountId: to.id, date: toDay(input.date), amount: input.amount, fee: input.fee, reference: input.reference ?? null, createdById: ctx.user.id } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "account_transfer.recorded", entityType: "AccountTransfer", entityId: t.id, metadata: { from: from.name, to: to.name, amount: input.amount, fee: input.fee } });
    return { id: t.id };
  });
}
