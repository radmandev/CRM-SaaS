import { describe, expect, it } from "vitest";
import { D } from "@/server/money";
import { buildItinerary, canTransition, customerPrice, deriveStatus, describe as describeItem, isActive, itemDates, itemMargin, itemTax, ITEM_TRANSITIONS, totals } from "@/modules/bookings/rules";
import { lineTax, round } from "@/server/money";
import type { BookingItemStatus } from "@/generated/prisma/enums";

const amounts = (sell: string, extra: Partial<Record<"fee" | "discount" | "cost" | "commission", string>> = {}) => ({
  sellAmount: D(sell), serviceFeeAmount: D(extra.fee ?? 0), discountAmount: D(extra.discount ?? 0), costAmount: D(extra.cost ?? 0), commissionAmount: D(extra.commission ?? 0),
});

describe("item transitions (§8.3, BKG-02)", () => {
  it("covers every status and forbids leaving CANCELLED", () => {
    const all = Object.keys(ITEM_TRANSITIONS) as BookingItemStatus[];
    expect(all.sort()).toEqual(["CANCELLED", "CONFIRMED", "FAILED", "HELD", "ISSUED", "ON_REQUEST", "REQUESTED"]);
    expect(ITEM_TRANSITIONS.CANCELLED).toEqual([]);
    for (const s of all.filter((x) => x !== "CANCELLED")) expect(canTransition(s, "CANCELLED"), s).toBe(true);
  });
  it("only moves forward along the supplier workflow", () => {
    expect(canTransition("REQUESTED", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "ISSUED")).toBe(true);
    expect(canTransition("ISSUED", "CONFIRMED")).toBe(false);
    expect(canTransition("CONFIRMED", "HELD")).toBe(false);
    expect(canTransition("FAILED", "REQUESTED")).toBe(true);
    expect(canTransition("REQUESTED", "ISSUED")).toBe(false);
  });
});

describe("derived booking status (BKG-04)", () => {
  const items = (...s: BookingItemStatus[]) => s.map((status) => ({ status }));
  it("drafts, holds, confirms and issues from item states", () => {
    expect(deriveStatus("DRAFT", null, [])).toBe("DRAFT");
    expect(deriveStatus("DRAFT", null, items("REQUESTED", "HELD"))).toBe("ON_HOLD");
    expect(deriveStatus("ON_HOLD", null, items("CONFIRMED", "REQUESTED"))).toBe("DRAFT");
    expect(deriveStatus("DRAFT", new Date(), items("CONFIRMED", "ISSUED"))).toBe("CONFIRMED");
    expect(deriveStatus("CONFIRMED", new Date(), items("ISSUED", "ISSUED", "CANCELLED"))).toBe("ISSUED");
  });
  it("cancels when every item is cancelled and keeps terminal states", () => {
    expect(deriveStatus("CONFIRMED", new Date(), items("CANCELLED", "CANCELLED"))).toBe("CANCELLED");
    expect(deriveStatus("DRAFT", null, items("FAILED"))).toBe("DRAFT");
    expect(deriveStatus("COMPLETED", new Date(), items("CANCELLED"))).toBe("COMPLETED");
    expect(deriveStatus("CANCELLED", null, items("REQUESTED"))).toBe("CANCELLED");
    expect(isActive("FAILED")).toBe(false);
  });
});

describe("money (FIN-01/02, TAX-04, SVC-07)", () => {
  it("rounds half-up per line and back-calculates inclusive tax", () => {
    expect(round(D("1.005"), "SAR").toString()).toBe("1.01");
    expect(round(D("1.0005"), "KWD").toString()).toBe("1.001"); // 3-decimal currency
    expect(lineTax(D("100"), D("15"), false, "SAR").toString()).toBe("15");
    expect(lineTax(D("115"), D("15"), true, "SAR").toString()).toBe("15");
    expect(lineTax(D("99.99"), D("15"), true, "SAR").toString()).toBe("13.04");
    expect(lineTax(D("100"), D("0"), false, "SAR").toString()).toBe("0");
  });
  it("taxes the full price or the service fee only", () => {
    const a = amounts("1000", { fee: "100", discount: "50" });
    expect(customerPrice(a).toString()).toBe("1050");
    expect(itemTax(a, "FULL_AMOUNT", D(15), false, "SAR").toString()).toBe("157.5");
    expect(itemTax(a, "SERVICE_FEE_ONLY", D(15), false, "SAR").toString()).toBe("15");
    expect(itemTax(a, "FULL_AMOUNT", null, false, "SAR").toString()).toBe("0");
  });
  it("computes margin as sell + fee + commission − cost − discount", () => {
    expect(itemMargin(amounts("1000", { fee: "50", commission: "80", cost: "900", discount: "30" })).toString()).toBe("200");
  });
  it("totals active items and only the fees of cancelled ones", () => {
    const t = totals({
      inclusive: false,
      currency: "SAR",
      items: [
        { ...amounts("1000", { cost: "800", commission: "20" }), status: "CONFIRMED", taxAmount: D(150) },
        { ...amounts("500", { cost: "400" }), status: "CANCELLED", taxAmount: D(75), cancellation: { supplierFee: D(100), agencyFee: D(25) } },
        { ...amounts("300", { cost: "300" }), status: "FAILED", taxAmount: D(45) },
      ],
      amendments: [{ supplierFee: D(10), agencyFee: D(40) }],
    });
    expect(t.sellTotal.toString()).toBe("1175"); // 1000 + (100+25) + (10+40)
    expect(t.costTotal.toString()).toBe("910"); // 800 + 100 + 10
    expect(t.taxTotal.toString()).toBe("150");
    expect(t.grandTotal.toString()).toBe("1325");
    expect(t.commissionTotal.toString()).toBe("20");
  });
  it("keeps tax inside the price when prices include tax", () => {
    const t = totals({ inclusive: true, currency: "SAR", items: [{ ...amounts("1150"), status: "CONFIRMED", taxAmount: D(150) }], amendments: [] });
    expect(t.grandTotal.toString()).toBe("1150");
    expect(t.sellTotal.toString()).toBe("1000");
  });
});

describe("dates, descriptions and itinerary (SVC-01, BKG-11)", () => {
  const flight = { segments: [{ carrier: "SV", flightNumber: "802", origin: "RUH", destination: "KUL", departureLocal: "2026-12-01T23:30", arrivalLocal: "2026-12-02T13:10", cabin: "ECONOMY" }, { carrier: "SV", flightNumber: "803", origin: "KUL", destination: "RUH", departureLocal: "2026-12-10T15:00", arrivalLocal: "2026-12-10T19:20", cabin: "ECONOMY" }] };
  it("derives dates from flight segments and hotel stays, else requires them", () => {
    expect(itemDates("FLIGHT", flight)).toEqual({ startDate: "2026-12-01", endDate: "2026-12-10" });
    expect(itemDates("HOTEL", { checkIn: "2026-12-02", checkOut: "2026-12-09" })).toEqual({ startDate: "2026-12-02", endDate: "2026-12-09" });
    expect(itemDates("TOUR", { date: "2026-12-05" })).toEqual({ startDate: "2026-12-05", endDate: "2026-12-05" });
    expect(itemDates("OTHER", {})).toBeNull();
    expect(itemDates("VISA", {}, "2026-11-01")).toEqual({ startDate: "2026-11-01", endDate: "2026-11-01" });
  });
  it("describes items for customers", () => {
    expect(describeItem("FLIGHT", flight)).toBe("RUH–KUL–RUH (SV802, SV803)");
    expect(describeItem("HOTEL", { hotelName: "Grand", city: "Kuala Lumpur" })).toBe("Grand, Kuala Lumpur");
  });
  it("orders entries by local date and time and skips cancelled services", () => {
    const entries = buildItinerary(
      [
        { id: "f", serviceType: "FLIGHT", status: "CONFIRMED", description: "x", startDate: "2026-12-01", endDate: "2026-12-10", details: flight, supplierConfirmation: null, pnr: "ABC123" },
        { id: "h", serviceType: "HOTEL", status: "CONFIRMED", description: "Grand, KL", startDate: "2026-12-02", endDate: "2026-12-09", details: {}, supplierConfirmation: "H-1", pnr: null },
        { id: "c", serviceType: "TOUR", status: "CANCELLED", description: "Cancelled tour", startDate: "2026-12-03", endDate: "2026-12-03", details: { date: "2026-12-03" }, supplierConfirmation: null, pnr: null },
      ],
      [{ date: "2026-12-05", text: "Free day" }],
    );
    expect(entries.map((e) => `${e.date} ${e.kind}`)).toEqual(["2026-12-01 FLIGHT", "2026-12-02 CHECK_IN", "2026-12-05 NOTE", "2026-12-09 CHECK_OUT", "2026-12-10 FLIGHT"]);
    expect(entries[0].detail).toContain("PNR ABC123");
  });
});
