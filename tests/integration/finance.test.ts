import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { addMember, call, createAgency, prisma, randomUUID, uniq, type Handler, type TestAgency } from "../helpers";
import * as customers from "@/app/api/v1/customers/route";
import * as bookings from "@/app/api/v1/bookings/route";
import * as bookingItems from "@/app/api/v1/bookings/[id]/items/route";
import * as invoices from "@/app/api/v1/invoices/route";
import * as invoice from "@/app/api/v1/invoices/[id]/route";
import * as issue from "@/app/api/v1/invoices/[id]/issue/route";
import * as creditNotes from "@/app/api/v1/invoices/[id]/credit-notes/route";
import * as sendInvoice from "@/app/api/v1/invoices/[id]/send/route";
import * as payments from "@/app/api/v1/payments/route";
import * as reversePayment from "@/app/api/v1/payments/[id]/reverse/route";
import * as allocate from "@/app/api/v1/payments/[id]/allocate/route";
import * as refunds from "@/app/api/v1/refunds/route";
import * as approveRefund from "@/app/api/v1/refunds/[id]/approve/route";
import * as paidRefund from "@/app/api/v1/refunds/[id]/paid/route";
import * as balance from "@/app/api/v1/customers/[id]/balance/route";
import * as statement from "@/app/api/v1/customers/[id]/statement/route";
import * as suppliers from "@/app/api/v1/suppliers/route";
import * as bills from "@/app/api/v1/supplier-bills/route";
import * as supplierPayments from "@/app/api/v1/supplier-payments/route";
import * as expenses from "@/app/api/v1/expenses/route";
import * as approveExpense from "@/app/api/v1/expenses/[id]/approve/route";
import * as accounts from "@/app/api/v1/financial-accounts/route";
import * as transfers from "@/app/api/v1/financial-accounts/transfers/route";
import * as reports from "@/app/api/v1/reports/[name]/route";
import * as download from "@/app/api/v1/documents/[id]/download/route";
import { decodeZatcaQr } from "@/modules/finance/zatca";
import { generateDocument } from "@/modules/documents/render";
import { sendDocumentEmail } from "@/modules/documents/email";
import { fakeOutbox } from "@/server/email";
import { env } from "@/server/env";

let A: TestAgency;
let customerId: string;
let corporateId: string;
let cash: string;
let bank: string;
const today = new Date().toISOString().slice(0, 10);

const post = (h: Handler, path: string, body: unknown, cookie = A.ownerCookie, params: Record<string, string> = {}, headers?: Record<string, string>) => call(h, "POST", path, { cookie, body, params, headers });
const hotel = (sell: string, cost = "0") => ({ serviceType: "HOTEL", sellAmount: sell, costAmount: cost, taxRateId: vatId, details: { hotelName: "Hilton", city: "Riyadh", checkIn: "2026-12-01", checkOut: "2026-12-03", rooms: [{ roomType: "King" }] } });
let vatId: string;

async function completeProfile(tenantId: string) {
  await prisma.tenant.update({ where: { id: tenantId }, data: { legalNameAr: "وكالة الاختبار", vatRegistered: true, vatNumber: "300000000000003", crNumber: "1010123456", addressBuilding: "1234", addressStreet: "King Fahd Rd", addressDistrict: "Olaya", addressCity: "Riyadh", addressPostalCode: "12345" } });
}

async function bookingWithInvoice(sell = "1000", cust = customerId) {
  const b = (await post(bookings.POST as Handler, "/api/v1/bookings", { customerId: cust, confirmDuplicate: true })).json.data;
  await post(bookingItems.POST as Handler, "", hotel(sell), A.ownerCookie, { id: b.id });
  const draft = await post(invoices.POST as Handler, "/api/v1/invoices", { bookingId: b.id });
  expect(draft.status, draft.text).toBe(201);
  return { bookingId: b.id as string, invoiceId: draft.json.data.id as string };
}
const issueIt = (id: string, cookie = A.ownerCookie) => post(issue.POST as Handler, "", undefined, cookie, { id });
const getInv = async (id: string) => (await call(invoice.GET as Handler, "GET", "", { cookie: A.ownerCookie, params: { id } })).json.data;

beforeAll(async () => {
  A = await createAgency({ plan: "PROFESSIONAL" });
  customerId = (await post(customers.POST as Handler, "/api/v1/customers", { type: "INDIVIDUAL", firstName: "Noura", lastName: "Saud", email: `noura-${uniq()}@example.com` })).json.data.id;
  corporateId = (await post(customers.POST as Handler, "/api/v1/customers", { type: "CORPORATE", displayName: "Aramco Travel Desk" })).json.data.id;
  vatId = (await prisma.taxRate.findFirstOrThrow({ where: { tenantId: A.tenantId, code: "VAT15" } })).id;
  const accs = await prisma.financialAccount.findMany({ where: { tenantId: A.tenantId } });
  cash = accs.find((a) => a.type === "CASH")!.id;
  bank = accs.find((a) => a.type === "BANK")!.id;
}, 120_000);

describe("invoices (§11.2, INV-01..06, ZAT-01..03, ONB-01)", () => {
  it("refuses to issue until the agency profile is complete, then issues with number, ICV, UUID and a valid Phase 1 QR", async () => {
    const { invoiceId, bookingId } = await bookingWithInvoice();
    const blocked = await issueIt(invoiceId);
    expect(blocked.json.code).toBe("AGENCY_PROFILE_INCOMPLETE");
    await completeProfile(A.tenantId);
    const res = await issueIt(invoiceId);
    expect(res.status, res.text).toBe(200);
    expect(res.json.data.number).toMatch(/^INV-\d{4}-\d{6}$/);
    const inv = await getInv(invoiceId);
    expect(inv).toMatchObject({ status: "ISSUED", type: "SIMPLIFIED", total: "1150", taxAmount: "150", taxableAmount: "1000" });
    expect(inv.zatcaUuid).toMatch(/^[0-9a-f-]{36}$/);
    const [seller, vat, ts, total, tax] = decodeZatcaQr(inv.qrPayload);
    expect([seller, vat, total, tax]).toEqual(["وكالة الاختبار", "300000000000003", "1150.00", "150.00"]);
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect((await prisma.bookingItem.findFirstOrThrow({ where: { bookingId } })).invoicedQuantity).toBe(1);
    // INV-02: nothing left to invoice on this booking.
    expect((await post(invoices.POST as Handler, "/api/v1/invoices", { bookingId })).json.code).toBe("NOTHING_TO_INVOICE");
  });

  it("is immutable after issue — through the API and through direct SQL (FR-10, INV-03)", async () => {
    const { invoiceId } = await bookingWithInvoice();
    await issueIt(invoiceId);
    const inv = await getInv(invoiceId);
    expect((await call(invoice.PATCH as Handler, "PATCH", "", { cookie: A.ownerCookie, params: { id: invoiceId }, body: { version: inv.version, type: "STANDARD" } })).json.code).toBe("INVOICE_ISSUED");
    expect((await call(invoice.DELETE as Handler, "DELETE", "", { cookie: A.ownerCookie, params: { id: invoiceId } })).json.code).toBe("INVOICE_ISSUED");
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await expect(client.query('UPDATE invoice SET total = 1 WHERE id = $1', [invoiceId])).rejects.toThrow(/immutable/);
    await expect(client.query('DELETE FROM invoice WHERE id = $1', [invoiceId])).rejects.toThrow(/immutable/);
    await expect(client.query('UPDATE invoice_line SET "totalAmount" = 1 WHERE "invoiceId" = $1', [invoiceId])).rejects.toThrow(/immutable/);
    await client.query('UPDATE invoice SET "amountPaid" = "amountPaid" WHERE id = $1', [invoiceId]); // derived columns stay writable
    await client.end();
  });

  it("allocates gapless, unique numbers and ICVs when 10 invoices are issued at once (NUM-02, TST-07)", async () => {
    const drafts = [];
    for (let i = 0; i < 10; i++) drafts.push((await post(invoices.POST as Handler, "/api/v1/invoices", { customerId, lines: [{ descriptionEn: `Fee ${i}`, unitPrice: "100", discount: "0", taxRateId: vatId }] })).json.data.id);
    const before = await prisma.invoice.count({ where: { tenantId: A.tenantId, status: "ISSUED" } });
    const results = await Promise.all(drafts.map((id) => issueIt(id)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const nums = results.map((r) => Number(r.json.data.number.split("-")[2])).sort((a, b) => a - b);
    const icvs = results.map((r) => r.json.data.icv as number).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(10);
    expect(nums.at(-1)! - nums[0]).toBe(9);
    expect(icvs.at(-1)! - icvs[0]).toBe(9);
    expect(await prisma.invoice.count({ where: { tenantId: A.tenantId, status: "ISSUED" } })).toBe(before + 10);
    // A second issue of the same draft is refused.
    expect((await issueIt(drafts[0])).json.code).toBe("INVOICE_ISSUED");
  });

  it("requires buyer VAT number and address for standard (B2B) invoices (INV-06)", async () => {
    const d = await post(invoices.POST as Handler, "/api/v1/invoices", { customerId: corporateId, lines: [{ descriptionEn: "Corporate fee", unitPrice: "500", discount: "0", taxRateId: vatId }] });
    await prisma.customer.update({ where: { id: corporateId }, data: { vatNumber: "311111111100003" } });
    const inv = await getInv(d.json.data.id);
    await call(invoice.PATCH as Handler, "PATCH", "", { cookie: A.ownerCookie, params: { id: inv.id }, body: { version: inv.version, type: "STANDARD" } });
    expect((await issueIt(inv.id)).json.code).toBe("BUYER_DETAILS_REQUIRED");
    await prisma.customer.update({ where: { id: corporateId }, data: { address: "Dhahran, Eastern Province" } });
    expect((await issueIt(inv.id)).status).toBe(200);
    expect((await getInv(inv.id)).customerSnapshot).toMatchObject({ vatNumber: "311111111100003", address: "Dhahran, Eastern Province" });
  });

  it("only finance roles issue invoices; sales agents cannot", async () => {
    const sales = await addMember(A.ownerCookie, "SALES_AGENT", [A.branchId]);
    const res = await post(invoices.POST as Handler, "/api/v1/invoices", { customerId, lines: [{ descriptionEn: "x", unitPrice: "1", discount: "0" }] }, sales.cookie);
    expect(res.status).toBe(403);
  });
});

describe("payments and allocations (§11.4, PAY-01..07, TST-07)", () => {
  it("allocates, refuses over-allocation, updates the booking, and replays an Idempotency-Key", async () => {
    const { invoiceId, bookingId } = await bookingWithInvoice("2000");
    await issueIt(invoiceId);
    const pay = (amount: string, allocAmount: string, key?: string) =>
      post(payments.POST as Handler, "/api/v1/payments", { customerId, date: today, amount, method: "BANK_TRANSFER", financialAccountId: bank, allocations: [{ invoiceId, amount: allocAmount }] }, A.ownerCookie, {}, key ? { "idempotency-key": key } : undefined);
    expect((await pay("5000", "3000")).json.code).toBe("EXCEEDS_OUTSTANDING");
    expect((await pay("100", "200")).json.code).toBe("OVER_ALLOCATED");
    const key = randomUUID();
    const first = await pay("1000", "1000", key);
    expect(first.status).toBe(201);
    expect(first.json.data.number).toMatch(/^RCP-/);
    expect((await pay("1000", "1000", key)).json.data.id).toBe(first.json.data.id);
    expect((await getInv(invoiceId)).amountPaid).toBe("1000");
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect([b.paidTotal.toString(), b.balance.toString()]).toEqual(["1000", "1300"]);
  });

  it("never lets two concurrent payments over-allocate one invoice", async () => {
    const { invoiceId } = await bookingWithInvoice("1000"); // total 1150
    await issueIt(invoiceId);
    const results = await Promise.all(
      [1, 2].map(() => post(payments.POST as Handler, "/api/v1/payments", { customerId, date: today, amount: "700", method: "CASH", financialAccountId: cash, allocations: [{ invoiceId, amount: "700" }] })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect((await getInv(invoiceId)).amountPaid).toBe("700");
  });

  it("takes deposits as customer credit and allocates them later (PAY-02)", async () => {
    const { invoiceId, bookingId } = await bookingWithInvoice("400"); // 460
    const deposit = await post(payments.POST as Handler, "/api/v1/payments", { customerId, bookingId, date: today, amount: "460", method: "CASH", financialAccountId: cash });
    expect(deposit.status).toBe(201);
    await issueIt(invoiceId);
    const res = await post(allocate.POST as Handler, "", { invoiceId, amount: "460" }, A.ownerCookie, { id: deposit.json.data.id });
    expect(res.status).toBe(204);
    expect((await getInv(invoiceId)).outstanding).toBe("0");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).paidTotal.toString()).toBe("460");
  });

  it("reverses only with approval, releases allocations, and is immutable in SQL (PAY-04)", async () => {
    const { invoiceId } = await bookingWithInvoice("100");
    await issueIt(invoiceId);
    const p = await post(payments.POST as Handler, "/api/v1/payments", { customerId, date: today, amount: "115", method: "CASH", financialAccountId: cash, allocations: [{ invoiceId, amount: "115" }] });
    const sales = await addMember(A.ownerCookie, "SALES_AGENT", [A.branchId]);
    expect((await post(reversePayment.POST as Handler, "", { reason: "x" }, sales.cookie, { id: p.json.data.id })).status).toBe(403);
    expect((await post(reversePayment.POST as Handler, "", { reason: "Bounced transfer" }, A.ownerCookie, { id: p.json.data.id })).status).toBe(204);
    expect((await getInv(invoiceId)).amountPaid).toBe("0");
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await expect(client.query("UPDATE payment SET amount = 1 WHERE id = $1", [p.json.data.id])).rejects.toThrow(/immutable/);
    await expect(client.query("DELETE FROM payment_allocation WHERE \"paymentId\" = $1", [p.json.data.id])).rejects.toThrow(/immutable/);
    await client.end();
  });

  it("rejects card numbers in free text (SEC-21) and manual 'online gateway' payments (PAY-05)", async () => {
    const card = await post(payments.POST as Handler, "/api/v1/payments", { customerId, date: today, amount: "10", method: "CARD_POS", financialAccountId: cash, reference: "4111 1111 1111 1111" });
    expect(card.json.errors.map((e: { path: string }) => e.path)).toContain("reference");
    const gw = await post(payments.POST as Handler, "/api/v1/payments", { customerId, date: today, amount: "10", method: "ONLINE_GATEWAY", financialAccountId: cash });
    expect(gw.status).toBe(422);
  });
});

describe("credit notes and refunds (§11.3/11.5, INV-07, REF-01..03)", () => {
  it("credits up to the line remainder, creates customer credit, and refunds it with a second approver", async () => {
    const cust = (await post(customers.POST as Handler, "/api/v1/customers", { type: "INDIVIDUAL", firstName: "Refund", lastName: `Case${uniq()}` })).json.data.id;
    const { invoiceId, bookingId } = await bookingWithInvoice("1000", cust); // 1150
    await issueIt(invoiceId);
    await post(payments.POST as Handler, "/api/v1/payments", { customerId: cust, date: today, amount: "1150", method: "BANK_TRANSFER", financialAccountId: bank, allocations: [{ invoiceId, amount: "1150" }] });
    const line = (await getInv(invoiceId)).lines[0];
    expect((await post(creditNotes.POST as Handler, "", { reason: "Too much", lines: [{ originalLineId: line.id, amount: "2000" }] }, A.ownerCookie, { id: invoiceId })).json.code).toBe("CREDIT_EXCEEDS_LINE");
    const cn = await post(creditNotes.POST as Handler, "", { reason: "One night cancelled", lines: [{ originalLineId: line.id, amount: "575" }] }, A.ownerCookie, { id: invoiceId });
    expect(cn.status, cn.text).toBe(201);
    expect(cn.json.data.number).toMatch(/^CN-/);
    const cnInv = await getInv(cn.json.data.id);
    expect([cnInv.taxAmount, cnInv.taxableAmount, cnInv.total]).toEqual(["75", "500", "575"]); // tax split proportionally
    expect((await getInv(invoiceId)).amountCredited).toBe("575");
    const bal = (await call(balance.GET as Handler, "GET", "", { cookie: A.ownerCookie, params: { id: cust } })).json.data[0];
    expect(bal).toMatchObject({ invoiced: "1150.00", credited: "575.00", paid: "1150.00", balance: "-575.00" });

    expect((await post(refunds.POST as Handler, "/api/v1/refunds", { customerId: cust, bookingId, amount: "600", method: "BANK_TRANSFER", reason: "x" })).json.code).toBe("EXCEEDS_CREDIT");
    const r = await post(refunds.POST as Handler, "/api/v1/refunds", { customerId: cust, bookingId, creditNoteId: cn.json.data.id, amount: "575", method: "BANK_TRANSFER", reason: "Night cancelled" });
    expect(r.status).toBe(201);
    expect((await post(approveRefund.POST as Handler, "", {}, A.ownerCookie, { id: r.json.data.id })).json.code).toBe("SELF_APPROVAL");
    const accountant = await addMember(A.ownerCookie, "ACCOUNTANT", [A.branchId]);
    expect((await post(approveRefund.POST as Handler, "", { note: "ok" }, accountant.cookie, { id: r.json.data.id })).status).toBe(204);
    // A second refund for the same credit cannot be approved now.
    const r2 = await prisma.refund.create({ data: { tenantId: A.tenantId, number: `RF-T-${uniq()}`, customerId: cust, amount: "1", currency: "SAR", method: "CASH", reason: "dup", requestedById: A.ownerUserId } });
    expect((await post(approveRefund.POST as Handler, "", {}, accountant.cookie, { id: r2.id })).json.code).toBe("EXCEEDS_CREDIT");
    expect((await post(paidRefund.POST as Handler, "", { paidAt: today, financialAccountId: bank, reference: "TRX-77" }, accountant.cookie, { id: r.json.data.id })).status).toBe(204);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).paidTotal.toString()).toBe("575");
    // Fully crediting the line lets the service be invoiced again.
    await post(creditNotes.POST as Handler, "", { reason: "Rest cancelled", lines: [{ originalLineId: line.id, amount: "575" }] }, A.ownerCookie, { id: invoiceId });
    expect((await prisma.bookingItem.findFirstOrThrow({ where: { bookingId } })).invoicedQuantity).toBe(0);
    const st = await call(statement.GET as Handler, "GET", `/api/v1/customers/${cust}/statement?from=2026-01-01&to=${today}`, { cookie: A.ownerCookie, params: { id: cust } });
    expect(st.json.data.closing).toBe("-575.00"); // 1150 − 575 − 575 − 1150 + 575
  });
});

describe("payables, expenses, accounts (§11.6–11.8)", () => {
  it("records bills with variance, pays them, approves large expenses, and keeps account balances consistent", async () => {
    const sup = (await post(suppliers.POST as Handler, "/api/v1/suppliers", { type: "HOTEL", code: `HB${uniq().slice(0, 4)}`.toUpperCase(), nameEn: "Hotel Bed Co" })).json.data.id;
    const b = (await post(bookings.POST as Handler, "/api/v1/bookings", { customerId, confirmDuplicate: true })).json.data;
    const item = (await post(bookingItems.POST as Handler, "", hotel("1000", "800"), A.ownerCookie, { id: b.id })).json.data.id;
    const bill = await post(bills.POST as Handler, "/api/v1/supplier-bills", { supplierId: sup, supplierInvoiceNumber: "HB-1001", billDate: today, lines: [{ description: "2 nights", bookingItemId: item, amount: "850", taxAmount: "0" }] });
    expect(bill.status, bill.text).toBe(201);
    expect((await post(bills.POST as Handler, "/api/v1/supplier-bills", { supplierId: sup, supplierInvoiceNumber: "HB-1001", billDate: today, lines: [{ description: "dup", amount: "1", taxAmount: "0" }] })).status).toBe(409);
    const listed = await call(bills.GET as Handler, "GET", `/api/v1/supplier-bills?supplierId=${sup}`, { cookie: A.ownerCookie });
    expect(listed.json.data[0].lines[0].variance).toBe("50"); // SUP-03: billed 850 vs committed 800
    const sp = await post(supplierPayments.POST as Handler, "/api/v1/supplier-payments", { supplierId: sup, date: today, amount: "850", method: "BANK_TRANSFER", financialAccountId: bank, allocations: [{ billId: bill.json.data.id, amount: "850" }] });
    expect(sp.status).toBe(201);
    expect((await prisma.supplierBill.findUniqueOrThrow({ where: { id: bill.json.data.id } })).amountPaid.toString()).toBe("850");

    const cat = (await prisma.expenseCategory.findFirstOrThrow({ where: { tenantId: A.tenantId, nameEn: "Rent" } })).id;
    const small = await post(expenses.POST as Handler, "/api/v1/expenses", { date: today, categoryId: cat, description: "Stationery", amount: "200", taxAmount: "26.09", financialAccountId: cash });
    expect(small.json.data.status).toBe("RECORDED");
    const big = await post(expenses.POST as Handler, "/api/v1/expenses", { date: today, categoryId: cat, description: "Office rent", amount: "12000", taxAmount: "0", financialAccountId: bank });
    expect(big.json.data.status).toBe("PENDING_APPROVAL"); // FIN-08: above 5,000 limit
    expect((await post(approveExpense.POST as Handler, "", undefined, A.ownerCookie, { id: big.json.data.id })).json.code).toBe("SELF_APPROVAL");
    const acc = await addMember(A.ownerCookie, "ACCOUNTANT", [A.branchId]);
    expect((await post(approveExpense.POST as Handler, "", undefined, acc.cookie, { id: big.json.data.id })).status).toBe(204);

    const tr = await post(transfers.POST as Handler, "/api/v1/financial-accounts/transfers", { fromAccountId: cash, toAccountId: bank, date: today, amount: "100", fee: "0" });
    expect(tr.status).toBe(201);
    const rows = (await call(accounts.GET as Handler, "GET", "/api/v1/financial-accounts", { cookie: A.ownerCookie })).json.data;
    const recomputed = async (id: string) => {
      const [p, r, s, e, out, inn] = await Promise.all([
        prisma.payment.aggregate({ where: { financialAccountId: id, status: "RECORDED" }, _sum: { amount: true } }),
        prisma.refund.aggregate({ where: { financialAccountId: id, status: "PAID" }, _sum: { amount: true } }),
        prisma.supplierPayment.aggregate({ where: { financialAccountId: id, status: "RECORDED" }, _sum: { amount: true } }),
        prisma.expense.aggregate({ where: { financialAccountId: id, status: "RECORDED" }, _sum: { amount: true } }),
        prisma.accountTransfer.aggregate({ where: { fromAccountId: id }, _sum: { amount: true, fee: true } }),
        prisma.accountTransfer.aggregate({ where: { toAccountId: id }, _sum: { amount: true } }),
      ]);
      const n = (v: unknown) => Number(v ?? 0);
      return (n(p._sum.amount) - n(r._sum.amount) - n(s._sum.amount) - n(e._sum.amount) - n(out._sum.amount) - n(out._sum.fee) + n(inn._sum.amount)).toFixed(2);
    };
    for (const a of rows) expect(Number(a.balance).toFixed(2), a.name).toBe(await recomputed(a.id));
  });
});

describe("reports equal the documents (§11.9, FIN-09, TST-08)", () => {
  it("sales, VAT and AR aging add up to the issued documents", async () => {
    const q = `from=2026-01-01&to=${today}`;
    const r = async (name: string) => (await call(reports.GET as Handler, "GET", `/api/v1/reports/${name}?${q}`, { cookie: A.ownerCookie, params: { name } })).json.data;
    const docs = await prisma.invoice.findMany({ where: { tenantId: A.tenantId, status: "ISSUED" } });
    const net = docs.reduce((s, d) => s + (d.kind === "INVOICE" ? 1 : -1) * Number(d.taxableAmount) * Number(d.exchangeRate), 0);
    const vat = docs.reduce((s, d) => s + (d.kind === "INVOICE" ? 1 : -1) * Number(d.taxAmount) * Number(d.exchangeRate), 0);
    const sales = await r("sales");
    expect(Number(sales.totals.net)).toBeCloseTo(net, 2);
    expect(Number(sales.totals.vat)).toBeCloseTo(vat, 2);
    expect(Number(sales.byMonth.reduce((s: number, m: { amount: string }) => s + Number(m.amount), 0))).toBeCloseTo(net, 2);
    const v = await r("vat");
    expect(Number(v.outputVat)).toBeCloseTo(vat, 2);
    // Receivables only: an overpaid or over-credited invoice is customer credit, not a negative receivable.
    const outstanding = docs.filter((d) => d.kind === "INVOICE").reduce((s, d) => s + Math.max(0, Number(d.total) - Number(d.amountCredited) - Number(d.amountPaid)) * Number(d.exchangeRate), 0);
    const ar = await r("ar-aging");
    expect(Number(ar.totals.total)).toBeCloseTo(outstanding, 2);
    const unknown = await call(reports.GET as Handler, "GET", `/api/v1/reports/nope?${q}`, { cookie: A.ownerCookie, params: { name: "nope" } });
    expect(unknown.status).toBe(404);
    const viewer = await addMember(A.ownerCookie, "VIEWER", [A.branchId]);
    expect((await call(reports.GET as Handler, "GET", `/api/v1/reports/sales?${q}`, { cookie: viewer.cookie, params: { name: "sales" } })).status).toBe(403);
  });
});

describe("PDFs and document email (D-13, INV-05, QT-06)", () => {
  it.skipIf(!process.env.CHROME_PATH)("renders a bilingual invoice PDF once, serves it only to its tenant, and emails it with the PDF attached", async () => {
    expect(env().CHROME_PATH).toBeTruthy();
    const { invoiceId } = await bookingWithInvoice("300");
    await issueIt(invoiceId);
    const docId = await generateDocument(A.tenantId, "INVOICE", invoiceId);
    expect(await generateDocument(A.tenantId, "INVOICE", invoiceId)).toBe(docId); // generated once (immutability)
    const dl = await call(download.GET as Handler, "GET", "", { cookie: A.ownerCookie, params: { id: docId } });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(dl.text.startsWith("%PDF")).toBe(true);
    const B = await createAgency();
    expect((await call(download.GET as Handler, "GET", "", { cookie: B.ownerCookie, params: { id: docId } })).status).toBe(404);
    const viewer = await addMember(A.ownerCookie, "VIEWER", [A.branchId]);
    expect((await call(download.GET as Handler, "GET", "", { cookie: viewer.cookie, params: { id: docId } })).status).toBe(404);

    const send = await post(sendInvoice.POST as Handler, "", undefined, A.ownerCookie, { id: invoiceId });
    expect(send.status).toBe(200);
    const job = await prisma.job.findFirstOrThrow({ where: { tenantId: A.tenantId, type: "document.email" }, orderBy: { createdAt: "desc" } });
    await sendDocumentEmail(A.tenantId, job.payload as never);
    const mail = fakeOutbox.filter((m) => m.to === send.json.data.to).at(-1)!;
    expect(mail.attachments?.[0]).toMatchObject({ contentType: "application/pdf" });
    expect(await prisma.interaction.count({ where: { tenantId: A.tenantId, channel: "EMAIL", customerId } })).toBeGreaterThan(0);
  }, 120_000);
});
