import { z } from "zod";
import { currency } from "./schemas";
import { money } from "./schemas-travel";

// Phase 3 shared schemas: sales (§10) and operational finance (§11). Messages are i18n keys ("v.*").

const str = (max: number) => z.string().trim().max(max);
const req = (max: number) => str(max).min(1, "v.required");
const opt = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable()).optional();
const date = z.iso.date("v.date");
const uuid = z.uuid("v.invalid");
const bool = z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean());
const positive = money.refine((m) => Number(m) > 0, "v.positive");
const version = z.coerce.number().int().min(1);

/** SEC-21: card numbers never enter free text (13–19 digits passing Luhn). */
export function looksLikeCardNumber(text: string): boolean {
  // Whole digit runs only (groups may be separated by one space or dash): windows inside longer numbers such as
  // IBANs are not card numbers and must not be flagged.
  for (const m of text.matchAll(/\d(?:[ -]?\d)*/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}
const freeText = (max: number) => opt(str(max).refine((v) => !looksLikeCardNumber(v), "v.cardNumber"));

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD_POS", "ONLINE_GATEWAY", "CHEQUE", "OTHER"] as const;
// Online gateway payments are created only by verified gateway callbacks (PAY-05), never by hand.
const manualMethod = z.enum(PAYMENT_METHODS).exclude(["ONLINE_GATEWAY"]);

// ───────── Quotations (§10.1) ─────────

export const quotationCreateSchema = z.object({
  customerId: uuid,
  branchId: opt(uuid),
  currency: opt(currency),
  validUntil: opt(date),
  showItemPrices: bool.default(true),
  notes: opt(str(5000)),
  customerNotes: opt(str(5000)),
});

export const quotationUpdateSchema = z.object({
  version,
  validUntil: date,
  showItemPrices: bool.default(true),
  notes: opt(str(5000)),
  customerNotes: opt(str(5000)),
  termsEn: opt(str(10000)),
  termsAr: opt(str(10000)),
});

export const LOST_REASONS = ["PRICE", "AVAILABILITY", "COMPETITOR", "CUSTOMER_CANCELLED", "OTHER"] as const;
export const quotationRejectSchema = z.object({ version, lostReason: z.enum(LOST_REASONS), lostNote: opt(str(1000)) });
export const quotationAcceptSchema = z.object({ version, note: opt(str(1000)) });

// ───────── Invoices and credit notes (§11.2/11.3) ─────────

export const invoiceLineSchema = z.object({
  descriptionEn: req(300),
  descriptionAr: opt(str(300)),
  quantity: z.preprocess((v) => (v === "" || v == null ? "1" : v), z.string().trim().regex(/^\d{1,8}(\.\d{1,4})?$/, "v.quantity").refine((q) => Number(q) > 0, "v.positive")),
  unitPrice: money,
  discount: money,
  taxRateId: opt(uuid),
});

export const invoiceCreateSchema = z.union([
  z.object({ bookingId: uuid }),
  z.object({ customerId: uuid, branchId: opt(uuid), currency: opt(currency), notes: opt(str(2000)), lines: z.array(invoiceLineSchema).min(1, "v.lineRequired").max(200) }),
]);

export const invoiceUpdateSchema = z.object({
  version,
  type: z.enum(["STANDARD", "SIMPLIFIED"]),
  supplyDate: opt(date),
  notes: opt(str(2000)),
});

export const creditNoteSchema = z.object({
  reason: req(500), // ZATCA requires a reason for credit notes (INV-07)
  lines: z
    .array(z.object({ originalLineId: uuid, amount: positive }))
    .min(1, "v.lineRequired")
    .max(200),
});

// ───────── Payments and refunds (§11.4/11.5) ─────────

export const allocationSchema = z.object({ invoiceId: uuid, amount: positive });

export const paymentSchema = z.object({
  customerId: uuid,
  bookingId: opt(uuid),
  date,
  amount: positive,
  currency: opt(currency),
  method: manualMethod,
  reference: freeText(100),
  financialAccountId: uuid,
  notes: freeText(1000),
  allocations: z
    .preprocess((v) => (Array.isArray(v) ? v.filter((a) => a && typeof a === "object" && String((a as { amount?: unknown }).amount ?? "").trim() !== "" && Number((a as { amount?: unknown }).amount) !== 0) : v), z.array(allocationSchema).max(100))
    .default([]),
});

export const reverseSchema = z.object({ reason: req(500) });

export const refundRequestSchema = z.object({
  customerId: uuid,
  bookingId: opt(uuid),
  creditNoteId: opt(uuid),
  amount: positive,
  currency: opt(currency),
  method: manualMethod,
  reason: req(500),
});
export const refundDecisionSchema = z.object({ note: opt(str(500)) });
export const refundPaidSchema = z.object({ paidAt: date, financialAccountId: uuid, reference: freeText(100) });

// ───────── Payables and expenses (§11.6/11.7) ─────────

export const supplierBillSchema = z.object({
  supplierId: uuid,
  supplierInvoiceNumber: req(60),
  billDate: date,
  dueDate: opt(date),
  currency: opt(currency),
  notes: freeText(1000),
  lines: z
    .array(z.object({ description: req(300), bookingItemId: opt(uuid), amount: money, taxAmount: money }))
    .min(1, "v.lineRequired")
    .max(200),
});

export const supplierPaymentSchema = z.object({
  supplierId: uuid,
  date,
  amount: positive,
  currency: opt(currency),
  method: manualMethod,
  reference: freeText(100),
  financialAccountId: uuid,
  allocations: z
    .preprocess((v) => (Array.isArray(v) ? v.filter((a) => a && typeof a === "object" && String((a as { amount?: unknown }).amount ?? "").trim() !== "" && Number((a as { amount?: unknown }).amount) !== 0) : v), z.array(z.object({ billId: uuid, amount: positive })).max(100))
    .default([]),
});

export const expenseSchema = z.object({
  date,
  branchId: opt(uuid),
  categoryId: uuid,
  description: req(300),
  amount: positive,
  taxAmount: money,
  currency: opt(currency),
  financialAccountId: uuid,
  payee: freeText(200),
  supplierId: opt(uuid),
  bookingId: opt(uuid),
});

// ───────── Accounts (§11.8) and settings ─────────

export const financialAccountSchema = z.object({
  name: req(100),
  type: z.enum(["CASH", "BANK", "GATEWAY_CLEARING"]),
  currency,
  branchId: opt(uuid),
  openingBalance: money,
});

export const transferSchema = z
  .object({ fromAccountId: uuid, toAccountId: uuid, date, amount: positive, fee: money, reference: freeText(100) })
  .refine((t) => t.fromAccountId !== t.toAccountId, { path: ["toAccountId"], message: "v.sameAccount" });

export const financeSettingsSchema = z.object({
  discountApprovalPercent: z.string().trim().regex(/^\d{1,3}(\.\d{1,4})?$/, "v.percent").refine((r) => Number(r) <= 100, "v.percent"),
  expenseApprovalLimit: money,
  refundSelfApproval: bool.default(false),
  quotationValidityDays: z.coerce.number().int().min(1).max(365),
  quotationTermsEn: opt(str(10000)),
  quotationTermsAr: opt(str(10000)),
});

// ───────── Reports (§11.9) ─────────

export const REPORTS = ["sales", "margin", "ar-aging", "ap-aging", "cash", "payments", "expenses", "vat", "profit"] as const;
export const reportQuery = z
  .strictObject({ from: date, to: date, branchId: uuid.optional(), asOf: date.optional() })
  .refine((q) => q.from <= q.to, { path: ["to"], message: "v.endAfterStart" });
export const statementQuery = z.strictObject({ from: date, to: date });
