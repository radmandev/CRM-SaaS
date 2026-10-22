import type { BookingItemStatus, BookingStatus, ServiceType, TaxBasis } from "@/generated/prisma/enums";
import { D, lineTax, round, sum, ZERO, type Money } from "@/server/money";

// Pure booking rules (§8). No I/O, so every branch is unit-tested.

/** §8.3 item lifecycle. Cancellation has its own action (BKG-14) and is allowed from any non-final state. */
export const ITEM_TRANSITIONS: Record<BookingItemStatus, BookingItemStatus[]> = {
  REQUESTED: ["ON_REQUEST", "HELD", "CONFIRMED", "FAILED", "CANCELLED"],
  ON_REQUEST: ["HELD", "CONFIRMED", "FAILED", "CANCELLED"],
  HELD: ["CONFIRMED", "FAILED", "CANCELLED"],
  CONFIRMED: ["ISSUED", "CANCELLED"],
  ISSUED: ["CANCELLED"],
  FAILED: ["REQUESTED", "CANCELLED"],
  CANCELLED: [],
};

export const canTransition = (from: BookingItemStatus, to: BookingItemStatus) => ITEM_TRANSITIONS[from].includes(to);

const INACTIVE: BookingItemStatus[] = ["CANCELLED", "FAILED"];
export const isActive = (s: BookingItemStatus) => !INACTIVE.includes(s);

/** BKG-04: booking status from its items. COMPLETED and explicit CANCELLED are terminal. */
export function deriveStatus(current: BookingStatus, confirmedAt: Date | null, items: { status: BookingItemStatus }[]): BookingStatus {
  if (current === "COMPLETED" || current === "CANCELLED") return current;
  const active = items.filter((i) => isActive(i.status));
  if (items.length && !active.length && items.some((i) => i.status === "CANCELLED")) return "CANCELLED";
  if (confirmedAt) return active.length && active.every((i) => i.status === "ISSUED") ? "ISSUED" : "CONFIRMED";
  return active.some((i) => i.status === "HELD" || i.status === "ON_REQUEST") ? "ON_HOLD" : "DRAFT";
}

/** Booking-level statuses in which items, prices and passengers may be edited directly; later, amendments (BKG-18/20). */
export const isDirectlyEditable = (s: BookingStatus) => s === "DRAFT" || s === "ON_HOLD";
export const isClosed = (s: BookingStatus) => s === "CANCELLED" || s === "COMPLETED";

// ───────── Money (SVC-07, TAX-04) ─────────

export type ItemAmounts = { sellAmount: Money; serviceFeeAmount: Money; discountAmount: Money; costAmount: Money; commissionAmount: Money };

/** What the customer pays for the line, before (exclusive) or including (inclusive) tax. Amounts are line totals. */
export const customerPrice = (i: ItemAmounts) => i.sellAmount.plus(i.serviceFeeAmount).minus(i.discountAmount);

export function itemTax(i: ItemAmounts, basis: TaxBasis, ratePercent: Money | null, inclusive: boolean, currency: string): Money {
  if (!ratePercent) return round(ZERO, currency);
  const base = basis === "SERVICE_FEE_ONLY" ? i.serviceFeeAmount : customerPrice(i);
  return lineTax(base, ratePercent, inclusive, currency);
}

/** SVC-07: gross margin = sell + service fee + commission − cost − discount. */
export const itemMargin = (i: ItemAmounts) => i.sellAmount.plus(i.serviceFeeAmount).plus(i.commissionAmount).minus(i.costAmount).minus(i.discountAmount);

export type TotalsInput = {
  inclusive: boolean;
  currency: string;
  items: (ItemAmounts & { status: BookingItemStatus; taxAmount: Money; cancellation?: { supplierFee: Money; agencyFee: Money } | null })[];
  amendments: { supplierFee: Money; agencyFee: Money }[];
};

/**
 * Booking totals (§8.1). Cancelled items contribute only their fees (BKG-15/16): the customer is charged
 * supplier + agency fee, the agency's cost is the supplier fee. Applied amendment fees work the same way.
 * Tax on fees is decided at invoicing (Phase 3), so fees are untaxed here.
 */
export function totals({ inclusive, currency, items, amendments }: TotalsInput) {
  const active = items.filter((i) => isActive(i.status));
  const fees = [...items.flatMap((i) => (i.status === "CANCELLED" && i.cancellation ? [i.cancellation] : [])), ...amendments];
  const feeCharge = sum(fees.map((f) => f.supplierFee.plus(f.agencyFee)));
  const taxTotal = sum(active.map((i) => i.taxAmount));
  const lines = sum(active.map(customerPrice));
  const sellTotal = round((inclusive ? lines.minus(taxTotal) : lines).plus(feeCharge), currency);
  const grandTotal = round(sellTotal.plus(taxTotal), currency);
  return {
    sellTotal,
    costTotal: round(sum(active.map((i) => i.costAmount)).plus(sum(fees.map((f) => f.supplierFee))), currency),
    commissionTotal: round(sum(active.map((i) => i.commissionAmount)), currency),
    taxTotal,
    grandTotal,
  };
}

/**
 * QT-10 / SVC-08: a quote or booking needs a manager's approval when the total discount exceeds the tenant's
 * threshold (percent of gross) or any active line sells below cost.
 */
export function needsApproval(items: (ItemAmounts & { status?: BookingItemStatus })[], thresholdPercent: Money): boolean {
  const active = items.filter((i) => !i.status || isActive(i.status));
  const gross = sum(active.map((i) => i.sellAmount.plus(i.serviceFeeAmount)));
  const discount = sum(active.map((i) => i.discountAmount));
  if (!gross.isZero() && discount.times(100).dividedBy(gross).greaterThan(thresholdPercent)) return true;
  return active.some((i) => customerPrice(i).lessThan(i.costAmount));
}

// ───────── Dates and itinerary (§8.5) ─────────

type Details = Record<string, unknown>;

/** SVC-01: flight and hotel dates come from their details; other types use the given dates. */
export function itemDates(type: ServiceType, details: Details, start?: string | null, end?: string | null): { startDate: string; endDate: string } | null {
  if (type === "FLIGHT") {
    const segs = details.segments as { departureLocal: string; arrivalLocal: string }[];
    return { startDate: segs[0].departureLocal.slice(0, 10), endDate: segs.at(-1)!.arrivalLocal.slice(0, 10) };
  }
  if (type === "HOTEL") return { startDate: String(details.checkIn), endDate: String(details.checkOut) };
  if (type === "TOUR" && !start) return { startDate: String(details.date), endDate: String(details.date) };
  if (type === "TRANSFER" && !start) {
    const d = String(details.pickupAt).slice(0, 10);
    return { startDate: d, endDate: d };
  }
  if (!start) return null;
  return { startDate: start, endDate: end ?? start };
}

/** Default line description (shown to customers) from the details when the user leaves it empty. */
export function describe(type: ServiceType, details: Details): string {
  switch (type) {
    case "FLIGHT": {
      const segs = details.segments as { origin: string; destination: string; carrier: string; flightNumber: string }[];
      return `${segs.map((s) => s.origin).join("–")}–${segs.at(-1)!.destination} (${segs.map((s) => `${s.carrier}${s.flightNumber}`).join(", ")})`;
    }
    case "HOTEL":
      return `${details.hotelName}, ${details.city}`;
    case "TRANSFER":
      return `${details.pickupLocation} → ${details.dropoffLocation}`;
    case "TOUR":
    case "PACKAGE":
      return String(details.name);
    case "VISA":
      return `Visa ${details.destinationCountry} (${details.visaType})`;
    default:
      return type;
  }
}

export type ItineraryEntry = { date: string; time: string | null; kind: string; title: string; detail: string | null; itemId: string | null; status: string | null };

/**
 * BKG-11: one entry per flight segment (local airport time), hotel check-in and check-out (date only), and
 * other item starts; notes are added per day. Ordered by date, then time; entries without a time sort first.
 */
export function buildItinerary(
  items: { id: string; serviceType: ServiceType; status: BookingItemStatus; description: string; startDate: string; endDate: string; details: Details; supplierConfirmation: string | null; pnr: string | null }[],
  notes: { date: string; text: string }[],
): ItineraryEntry[] {
  const out: ItineraryEntry[] = [];
  for (const i of items.filter((x) => x.status !== "CANCELLED" && x.status !== "FAILED")) {
    if (i.serviceType === "FLIGHT") {
      for (const s of i.details.segments as { carrier: string; flightNumber: string; origin: string; destination: string; departureLocal: string; arrivalLocal: string; cabin: string }[])
        out.push({ date: s.departureLocal.slice(0, 10), time: s.departureLocal.slice(11, 16), kind: "FLIGHT", title: `${s.carrier}${s.flightNumber} ${s.origin} → ${s.destination}`, detail: `${s.arrivalLocal.slice(0, 10)} ${s.arrivalLocal.slice(11, 16)} · ${s.cabin}${i.pnr ? ` · PNR ${i.pnr}` : ""}`, itemId: i.id, status: i.status });
    } else if (i.serviceType === "HOTEL") {
      out.push({ date: i.startDate, time: null, kind: "CHECK_IN", title: i.description, detail: i.supplierConfirmation, itemId: i.id, status: i.status });
      out.push({ date: i.endDate, time: null, kind: "CHECK_OUT", title: i.description, detail: null, itemId: i.id, status: i.status });
    } else {
      const time = i.serviceType === "TRANSFER" ? String(i.details.pickupAt).slice(11, 16) : i.serviceType === "TOUR" ? ((i.details.startTime as string | null) ?? null) : null;
      out.push({ date: i.startDate, time, kind: i.serviceType, title: i.description, detail: i.supplierConfirmation, itemId: i.id, status: i.status });
    }
  }
  for (const n of notes) out.push({ date: n.date, time: null, kind: "NOTE", title: n.text, detail: null, itemId: null, status: null });
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
}

export { D };
