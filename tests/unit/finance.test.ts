import { describe, expect, it } from "vitest";
import { decodeZatcaQr, zatcaQr } from "@/modules/finance/zatca";
import { looksLikeCardNumber, paymentSchema, creditNoteSchema } from "@/lib/schemas-finance";
import { needsApproval } from "@/modules/bookings/rules";
import { D } from "@/server/money";

describe("ZATCA Phase 1 QR (ZAT-02)", () => {
  it("matches ZATCA's published example byte for byte", () => {
    const qr = zatcaQr({ sellerName: "Bobs Records", vatNumber: "310122393500003", timestamp: "2022-04-25T15:30:00Z", total: "1000.00", vatTotal: "150.00" });
    expect(qr).toBe("AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==");
  });
  it("encodes Arabic seller names by UTF-8 byte length and round-trips", () => {
    const qr = zatcaQr({ sellerName: "شركة السفر", vatNumber: "300000000000003", timestamp: "2026-10-20T10:00:00Z", total: "1150.00", vatTotal: "150.00" });
    expect(Buffer.from(qr, "base64")[1]).toBe(Buffer.byteLength("شركة السفر", "utf8"));
    expect(decodeZatcaQr(qr)).toEqual(["شركة السفر", "300000000000003", "2026-10-20T10:00:00Z", "1150.00", "150.00"]);
  });
  it("refuses values longer than one TLV length byte", () => {
    expect(() => zatcaQr({ sellerName: "x".repeat(256), vatNumber: "1", timestamp: "t", total: "1", vatTotal: "0" })).toThrow();
  });
});

describe("card data never enters free text (SEC-21)", () => {
  it("detects Luhn-valid card numbers with or without separators", () => {
    expect(looksLikeCardNumber("paid with 4111 1111 1111 1111 yesterday")).toBe(true);
    expect(looksLikeCardNumber("5555-5555-5555-4444")).toBe(true);
    expect(looksLikeCardNumber("Transfer ref 1234567890123")).toBe(false); // 13 digits, fails Luhn
    expect(looksLikeCardNumber("IBAN SA0380000000608010167519")).toBe(false); // contains Luhn-valid 13-digit windows
    expect(looksLikeCardNumber("Ticket 0651234567890 and 0651234567891")).toBe(false);
  });
  it("blocks them in payment references and notes", () => {
    const base = { customerId: "00000000-0000-7000-8000-000000000001", date: "2026-10-20", amount: "10", method: "CASH", financialAccountId: "00000000-0000-7000-8000-000000000002" };
    expect(paymentSchema.safeParse({ ...base, reference: "4111111111111111" }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...base, notes: "ok" }).success).toBe(true);
    expect(paymentSchema.safeParse({ ...base, method: "ONLINE_GATEWAY" }).success).toBe(false); // PAY-05
  });
});

describe("approval rule (QT-10)", () => {
  const i = (sell: string, discount = "0", cost = "0", fee = "0") => ({ sellAmount: D(sell), discountAmount: D(discount), costAmount: D(cost), serviceFeeAmount: D(fee), commissionAmount: D(0) });
  it("flags discounts above the threshold and below-cost lines", () => {
    expect(needsApproval([i("1000", "100")], D(10))).toBe(false); // exactly 10%
    expect(needsApproval([i("1000", "101")], D(10))).toBe(true);
    expect(needsApproval([i("100", "0", "120")], D(10))).toBe(true);
    expect(needsApproval([i("100", "0", "120", "30")], D(10))).toBe(false); // fee covers the cost
    expect(needsApproval([{ ...i("100", "0", "500"), status: "CANCELLED" as const }], D(10))).toBe(false);
  });
  it("credit note requests need a reason and positive amounts (INV-07)", () => {
    expect(creditNoteSchema.safeParse({ reason: "", lines: [{ originalLineId: "00000000-0000-7000-8000-000000000001", amount: "1" }] }).success).toBe(false);
    expect(creditNoteSchema.safeParse({ reason: "x", lines: [{ originalLineId: "00000000-0000-7000-8000-000000000001", amount: "0" }] }).success).toBe(false);
  });
});
