import { describe, expect, it } from "vitest";
import { agencySchema, brandColor, contrastWithWhite, email, numberingSchema, password, phone, signupSchema, slug, taxRateSchema } from "@/lib/schemas";

const baseAgency = {
  legalNameEn: "Noor", country: "SA", vatRegistered: false, baseCurrency: "SAR", enabledCurrencies: ["SAR"], timezone: "Asia/Riyadh",
  defaultLocale: "ar", weekStartsOn: 0, showHijri: false, pricesIncludeTax: false, primaryColor: "#0f766e",
};

describe("shared validation (FR-05)", () => {
  it("normalizes email and phone", () => {
    expect(email.parse("  Sara@Example.COM ")).toBe("sara@example.com");
    expect(phone.parse("0501234567")).toBe("+966501234567");
    expect(phone.safeParse("12").success).toBe(false);
  });

  it("enforces the password policy (AUTH-03)", () => {
    expect(password.safeParse("Correct-Horse-Battery-42").success).toBe(true);
    expect(password.safeParse("short").success).toBe(false);
    expect(password.safeParse("x".repeat(129)).success).toBe(false);
    expect(password.safeParse("PASSWORD1234").success).toBe(false); // common list, case-insensitive
  });

  it("validates slugs (ONB-02)", () => {
    expect(slug.parse("Al-Noor-Travel")).toBe("al-noor-travel");
    for (const bad of ["ab", "-abc", "abc-", "a b c", "x".repeat(41)]) expect(slug.safeParse(bad).success, bad).toBe(false);
  });

  it("applies Saudi formats only for SA agencies (KSA-08, §13.4)", () => {
    expect(agencySchema.safeParse({ ...baseAgency, vatRegistered: true, vatNumber: "300000000000003" }).success).toBe(true);
    expect(agencySchema.safeParse({ ...baseAgency, vatRegistered: true, vatNumber: "123456789012345" }).success).toBe(false);
    expect(agencySchema.safeParse({ ...baseAgency, country: "AE", vatRegistered: true, vatNumber: "123456789012345" }).success).toBe(true);
    expect(agencySchema.safeParse({ ...baseAgency, vatRegistered: true }).success).toBe(false);
    expect(agencySchema.safeParse({ ...baseAgency, crNumber: "123" }).success).toBe(false);
    expect(agencySchema.safeParse({ ...baseAgency, enabledCurrencies: ["USD"] }).success).toBe(false);
    expect(agencySchema.safeParse({ ...baseAgency, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(agencySchema.safeParse({ ...baseAgency, baseCurrency: "XYZ", enabledCurrencies: ["XYZ"] }).success).toBe(false);
  });

  it("requires accessible brand colors (§5.3)", () => {
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 0);
    expect(brandColor.safeParse("#0f766e").success).toBe(true);
    expect(brandColor.safeParse("#ffff00").success).toBe(false);
    expect(brandColor.safeParse("red").success).toBe(false);
  });

  it("validates tax rates and numbering prefixes", () => {
    const tax = { code: "vat15", nameEn: "VAT", nameAr: "ض", rate: "15", category: "STANDARD", active: true };
    expect(taxRateSchema.parse(tax).code).toBe("VAT15");
    expect(taxRateSchema.safeParse({ ...tax, rate: "150" }).success).toBe(false);
    expect(taxRateSchema.safeParse({ ...tax, rate: "1.23456" }).success).toBe(false);
    expect(numberingSchema.parse({ prefixes: { BOOKING: "trv" } }).prefixes.BOOKING).toBe("TRV");
    expect(numberingSchema.safeParse({ prefixes: { BOOKING: "TRV1" } }).success).toBe(false);
  });

  it("strips unknown fields such as a smuggled tenantId (TEN-02)", () => {
    const parsed = signupSchema.parse({ name: "A", email: "a@b.co", password: "Correct-Horse-Battery-42", agencyName: "X", slug: "abc", tenantId: "evil" });
    expect("tenantId" in parsed).toBe(false);
  });
});
