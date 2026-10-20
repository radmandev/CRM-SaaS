import { describe, expect, it } from "vitest";
import { expiresWithin, paxType, validDocumentNumber, validIban } from "@/lib/travel";
import { decrypt, encrypt, last4, lookupHash, needsReencryption } from "@/server/crypto";
import { bookingItemSchema, travelDocumentSchema, commissionRuleSchema, supplierSchema, itemChangesSchema, customerSchema } from "@/lib/schemas-travel";

describe("identifiers (CRM-09, §9.1)", () => {
  it("validates Saudi ID, Iqama and passport numbers", () => {
    expect(validDocumentNumber("NATIONAL_ID", "1012345678")).toBe(true);
    expect(validDocumentNumber("NATIONAL_ID", "2012345678")).toBe(false);
    expect(validDocumentNumber("IQAMA", "2012345678")).toBe(true);
    expect(validDocumentNumber("PASSPORT", "a1234567")).toBe(true);
    expect(validDocumentNumber("PASSPORT", "12")).toBe(false);
  });
  it("checks IBAN checksums (ISO 13616)", () => {
    expect(validIban("SA03 8000 0000 6080 1016 7519")).toBe(true);
    expect(validIban("SA03 8000 0000 6080 1016 7518")).toBe(false);
    expect(validIban("GB82WEST12345698765432")).toBe(true);
    expect(validIban("SA0380000000608010167")).toBe(false); // wrong length for SA
  });
  it("derives passenger type at the travel date (CRM-06)", () => {
    expect(paxType("2014-12-02", "2026-12-01")).toBe("CHD"); // turns 12 the day after
    expect(paxType("2014-12-01", "2026-12-01")).toBe("ADT");
    expect(paxType("2025-01-01", "2026-12-01")).toBe("INF");
    expect(paxType(null, "2026-12-01")).toBe("ADT");
  });
  it("warns about passports expiring within 6 months (CRM-10)", () => {
    expect(expiresWithin("2027-05-01", "2026-12-10")).toBe(true);
    expect(expiresWithin("2027-07-01", "2026-12-10")).toBe(false);
  });
});

describe("field encryption (SEC-10..12)", () => {
  it("round-trips, uses a fresh nonce, and rejects tampering", () => {
    const a = encrypt("A1234567");
    const b = encrypt("A1234567");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:k2:")).toBe(true); // active key in tests
    expect(decrypt(a)).toBe("A1234567");
    const parts = a.split(":");
    const body = Buffer.from(parts[3], "base64");
    body[0] ^= 1;
    expect(() => decrypt([...parts.slice(0, 3), body.toString("base64")].join(":"))).toThrow();
  });
  it("decrypts values written with an older key and flags them for rotation (SEC-11)", async () => {
    const { createCipheriv, randomBytes } = await import("node:crypto");
    const nonce = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", Buffer.alloc(32, 1), nonce);
    const body = Buffer.concat([c.update("OLDKEY99", "utf8"), c.final(), c.getAuthTag()]);
    const old = `v1:k1:${nonce.toString("base64")}:${body.toString("base64")}`;
    expect(decrypt(old)).toBe("OLDKEY99");
    expect(needsReencryption(old)).toBe(true);
  });
  it("hashes identifiers deterministically after normalization (CRM-08)", () => {
    expect(lookupHash("a 1234-567")).toBe(lookupHash("A1234567"));
    expect(lookupHash("A1234567")).not.toBe(lookupHash("A1234568"));
    expect(last4("a1234567")).toBe("4567");
  });
});

describe("Phase 2 schemas", () => {
  const flightItem = {
    serviceType: "FLIGHT", sellAmount: "1500", costAmount: "1200",
    details: { segments: [{ carrier: "sv", flightNumber: "802", origin: "ruh", destination: "kul", departureLocal: "2026-12-01T23:30", arrivalLocal: "2026-12-02T13:10" }] },
  };
  it("validates details per service type and normalizes codes", () => {
    const parsed = bookingItemSchema.parse(flightItem);
    expect((parsed.details.segments as { origin: string }[])[0].origin).toBe("RUH");
    expect(parsed.commissionAmount).toBe("0");
    const bad = bookingItemSchema.safeParse({ ...flightItem, details: { segments: [] } });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues[0].path.join(".")).toBe("details.segments");
    expect(bookingItemSchema.safeParse({ serviceType: "HOTEL", details: { hotelName: "H", city: "C", checkIn: "2026-12-05", checkOut: "2026-12-04", rooms: [{ roomType: "Double" }] } }).success).toBe(false);
    expect(bookingItemSchema.safeParse({ ...flightItem, sellAmount: "12.34567" }).success).toBe(false); // money: max 4 decimals
    expect(bookingItemSchema.safeParse({ ...flightItem, sellAmount: "-5" }).success).toBe(false);
  });
  it("requires valid, unexpired-looking documents", () => {
    expect(travelDocumentSchema.safeParse({ type: "PASSPORT", number: "A1234567", expiryDate: "2030-01-01" }).success).toBe(true);
    expect(travelDocumentSchema.safeParse({ type: "PASSPORT", number: "A1234567" }).success).toBe(false);
    expect(travelDocumentSchema.safeParse({ type: "NATIONAL_ID", number: "2012345678" }).success).toBe(false);
    expect(travelDocumentSchema.safeParse({ type: "IQAMA", number: "2012345678", issueDate: "2025-01-01", expiryDate: "2024-01-01" }).success).toBe(false);
  });
  it("validates commission rules and supplier IBANs", () => {
    expect(commissionRuleSchema.safeParse({ kind: "PERCENT", ratePercent: "7.5" }).success).toBe(true);
    expect(commissionRuleSchema.safeParse({ kind: "FIXED", fixedAmount: "50" }).success).toBe(false); // currency required
    expect(supplierSchema.safeParse({ type: "HOTEL", code: "H1", nameEn: "Hotel", iban: "SA03 8000 0000 6080 1016 7518" }).success).toBe(false);
  });

  it("change sets contain only what was sent (no defaults, empty fields dropped)", () => {
    expect(itemChangesSchema.parse({ sellAmount: "5" })).toEqual({ sellAmount: "5" });
    expect(itemChangesSchema.parse({ sellAmount: "5", costAmount: "", description: "" })).toEqual({ sellAmount: "5" });
    expect(itemChangesSchema.safeParse({}).success).toBe(false);
  });
  it("accepts comma-separated tags from forms", () => {
    expect(customerSchema.parse({ type: "CORPORATE", displayName: "Co", tags: "vip، family, " }).tags).toEqual(["vip", "family"]);
  });
});
