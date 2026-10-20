import { beforeAll, describe, expect, it } from "vitest";
import { addMember, call, createAgency, prisma, randomUUID, uniq, type Handler, type TestAgency } from "../helpers";
import * as customers from "@/app/api/v1/customers/route";
import * as travelers from "@/app/api/v1/customers/[id]/travelers/route";
import * as documents from "@/app/api/v1/travelers/[id]/documents/route";
import * as suppliers from "@/app/api/v1/suppliers/route";
import * as rules from "@/app/api/v1/suppliers/[id]/commission-rules/route";
import * as bookings from "@/app/api/v1/bookings/route";
import * as booking from "@/app/api/v1/bookings/[id]/route";
import * as confirm from "@/app/api/v1/bookings/[id]/confirm/route";
import * as cancelBooking from "@/app/api/v1/bookings/[id]/cancel/route";
import * as items from "@/app/api/v1/bookings/[id]/items/route";
import * as item from "@/app/api/v1/bookings/[id]/items/[itemId]/route";
import * as itemStatus from "@/app/api/v1/bookings/[id]/items/[itemId]/status/route";
import * as itemCancel from "@/app/api/v1/bookings/[id]/items/[itemId]/cancel/route";
import * as itemPax from "@/app/api/v1/bookings/[id]/items/[itemId]/passengers/route";
import * as passengers from "@/app/api/v1/bookings/[id]/passengers/route";
import * as paxReveal from "@/app/api/v1/bookings/[id]/passengers/[passengerId]/reveal/route";
import * as amendments from "@/app/api/v1/bookings/[id]/amendments/route";
import * as applyAmendment from "@/app/api/v1/bookings/[id]/amendments/[amendmentId]/apply/route";
import * as itinerary from "@/app/api/v1/bookings/[id]/itinerary/route";
import * as itineraryLink from "@/app/api/v1/bookings/[id]/itinerary-link/route";
import * as notes from "@/app/api/v1/bookings/[id]/notes/route";
import * as search from "@/app/api/v1/search/route";
import * as dashboard from "@/app/api/v1/dashboard/route";
import { publicItinerary, completeFinishedBookings } from "@/modules/bookings/service";

let A: TestAgency;
let customerId: string;
let travelerId: string;
let supplierId: string;
let vatId: string;

const flight = (o = "RUH", d = "KUL", dep = "2026-12-01T23:30", arr = "2026-12-02T13:10") => ({
  serviceType: "FLIGHT", supplierId, sellAmount: "2000", costAmount: "1700", taxRateId: vatId,
  details: { tripType: "ONE_WAY", segments: [{ carrier: "SV", flightNumber: "802", origin: o, destination: d, departureLocal: dep, arrivalLocal: arr }] },
});
const hotel = () => ({
  serviceType: "HOTEL", supplierId, sellAmount: "3000", costAmount: "2500",
  details: { hotelName: "Grand Hyatt", city: "Kuala Lumpur", checkIn: "2026-12-02", checkOut: "2026-12-09", rooms: [{ roomType: "Deluxe King", board: "BB", adults: 2 }] },
});

async function newBooking(cookie = A.ownerCookie, extra: Record<string, unknown> = {}) {
  const res = await call(bookings.POST as Handler, "POST", "/api/v1/bookings", { cookie, body: { customerId, confirmDuplicate: true, ...extra } });
  if (res.status !== 201) throw new Error(res.text);
  return res.json.data as { id: string; reference: string; version: number };
}
const get = async (id: string, cookie = A.ownerCookie) => (await call(booking.GET as Handler, "GET", `/api/v1/bookings/${id}`, { cookie, params: { id } })).json.data;
const addItem = (id: string, body: unknown, cookie = A.ownerCookie) => call(items.POST as Handler, "POST", `/api/v1/bookings/${id}/items`, { cookie, params: { id }, body });
const status = (id: string, itemId: string, body: unknown) => call(itemStatus.POST as Handler, "POST", `/api/v1/bookings/${id}/items/${itemId}/status`, { cookie: A.ownerCookie, params: { id, itemId }, body });
const addPax = (id: string, body: unknown) => call(passengers.POST as Handler, "POST", `/api/v1/bookings/${id}/passengers`, { cookie: A.ownerCookie, params: { id }, body });
const setPax = (id: string, itemId: string, passengerIds: string[]) => call(itemPax.POST as Handler, "POST", `/api/v1/bookings/${id}/items/${itemId}/passengers`, { cookie: A.ownerCookie, params: { id, itemId }, body: { passengerIds } });

beforeAll(async () => {
  A = await createAgency({ plan: "PROFESSIONAL" });
  customerId = (await call(customers.POST as Handler, "POST", "/api/v1/customers", { cookie: A.ownerCookie, body: { type: "INDIVIDUAL", firstName: "Sara", lastName: "Ali" } })).json.data.id;
  travelerId = (await call(travelers.POST as Handler, "POST", `/api/v1/customers/${customerId}/travelers`, { cookie: A.ownerCookie, params: { id: customerId }, body: { firstName: "Sara", lastName: "Ali", dateOfBirth: "1990-01-01", gender: "F" } })).json.data.id;
  await call(documents.POST as Handler, "POST", `/api/v1/travelers/${travelerId}/documents`, { cookie: A.ownerCookie, params: { id: travelerId }, body: { type: "PASSPORT", number: "P9876543", expiryDate: "2027-03-01" } });
  supplierId = (await call(suppliers.POST as Handler, "POST", "/api/v1/suppliers", { cookie: A.ownerCookie, body: { type: "CONSOLIDATOR", code: `SUP${uniq().slice(0, 4)}`.toUpperCase(), nameEn: "Gulf Consolidator", iban: "SA03 8000 0000 6080 1016 7519" } })).json.data.id;
  vatId = (await prisma.taxRate.findFirstOrThrow({ where: { tenantId: A.tenantId, code: "VAT15" } })).id;
}, 120_000);

describe("booking creation (BKG-01, BKG-22, BKG-23)", () => {
  it("assigns a per-tenant reference at creation and starts as DRAFT", async () => {
    const b = await newBooking();
    expect(b.reference).toMatch(/^BK-\d{4}-\d{6}$/);
    expect((await get(b.id)).status).toBe("DRAFT");
    expect(await prisma.bookingStatusHistory.count({ where: { bookingId: b.id, toStatus: "DRAFT" } })).toBe(1);
  });

  it("creates exactly one booking per Idempotency-Key, even in parallel", async () => {
    const key = randomUUID();
    const body = { customerId, confirmDuplicate: true, notes: "idem" };
    const send = (b = body) => call(bookings.POST as Handler, "POST", "/api/v1/bookings", { cookie: A.ownerCookie, body: b, headers: { "idempotency-key": key } });
    const first = await send();
    const replay = await send();
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.json.data.id).toBe(first.json.data.id);
    expect((await send({ ...body, notes: "different" })).json.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const key2 = randomUUID();
    const parallel = await Promise.all(Array.from({ length: 8 }, () => call(bookings.POST as Handler, "POST", "/api/v1/bookings", { cookie: A.ownerCookie, body: { customerId, confirmDuplicate: true, notes: "race" }, headers: { "idempotency-key": key2 } })));
    const ids = new Set(parallel.filter((r) => r.status === 201).map((r) => r.json.data.id));
    expect(ids.size).toBe(1);
    expect(parallel.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(await prisma.booking.count({ where: { tenantId: A.tenantId, notes: "race" } })).toBe(1);
  });

  it("warns about a second draft for the same customer within 24 h", async () => {
    await newBooking();
    const res = await call(bookings.POST as Handler, "POST", "/api/v1/bookings", { cookie: A.ownerCookie, body: { customerId } });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("POSSIBLE_DUPLICATE");
  });

  it("requires an exchange rate for foreign-currency bookings and snapshots it", async () => {
    const usd = await newBooking(A.ownerCookie, { currency: "USD" });
    expect((await get(usd.id)).exchangeRate).toBe("3.75");
    const eur = await call(bookings.POST as Handler, "POST", "/api/v1/bookings", { cookie: A.ownerCookie, body: { customerId, confirmDuplicate: true, currency: "EUR" } });
    expect(eur.status).toBe(422); // EUR not enabled by default
  });
});

describe("items, totals and commission (§7, SVC-07, SUP-01)", () => {
  it("validates airports, derives dates and description, computes tax and totals", async () => {
    const b = await newBooking();
    expect((await addItem(b.id, flight("RUH", "XXX"))).json.code).toBe("UNKNOWN_AIRPORT");
    const f = await addItem(b.id, flight());
    expect(f.status).toBe(201);
    expect(f.json.data.taxAmount).toBe("300");
    await addItem(b.id, hotel());
    const v = await get(b.id);
    expect(v.items[0].description).toBe("RUH–KUL (SV802)");
    expect(v.items[0].startDate).toBe("2026-12-01");
    expect(v.travelStartDate).toBe("2026-12-01");
    expect(v.travelEndDate).toBe("2026-12-09");
    expect(v.destinationSummary).toBe("KUL · Kuala Lumpur");
    expect([v.sellTotal, v.taxTotal, v.grandTotal, v.costTotal]).toEqual(["5000", "300", "5300", "4200"]);
  });

  it("prefills commission from the most specific rule", async () => {
    await call(rules.POST as Handler, "POST", `/api/v1/suppliers/${supplierId}/commission-rules`, { cookie: A.ownerCookie, params: { id: supplierId }, body: { kind: "PERCENT", ratePercent: "5" } });
    await call(rules.POST as Handler, "POST", `/api/v1/suppliers/${supplierId}/commission-rules`, { cookie: A.ownerCookie, params: { id: supplierId }, body: { kind: "PERCENT", ratePercent: "8", serviceType: "HOTEL" } });
    const b = await newBooking();
    expect((await addItem(b.id, hotel())).json.data.commissionAmount).toBe("240"); // 8% of 3000 (HOTEL rule beats supplier-wide)
    expect((await addItem(b.id, flight())).json.data.commissionAmount).toBe("100"); // 5% of 2000
    expect((await addItem(b.id, { ...flight(), commissionAmount: "33" })).json.data.commissionAmount).toBe("33"); // user override
  });

  it("rejects a discount larger than the price and hides margin from viewers", async () => {
    const b = await newBooking();
    expect((await addItem(b.id, { ...hotel(), discountAmount: "5000" })).json.code).toBe("DISCOUNT_TOO_HIGH");
    await addItem(b.id, hotel());
    const viewer = await addMember(A.ownerCookie, "VIEWER", [A.branchId]);
    const v = await get(b.id, viewer.cookie);
    expect(v.costTotal).toBeNull();
    expect(v.items[0].costAmount).toBeNull();
  });
});

describe("lifecycle (§8.2/8.3, BKG-02..08, BKG-10)", () => {
  it("runs requested → held → confirmed → issued with the required data, then confirms and issues the booking", async () => {
    const b = await newBooking();
    const fid = (await addItem(b.id, flight())).json.data.id;
    const hid = (await addItem(b.id, hotel())).json.data.id;
    const lead = await addPax(b.id, { travelerId });
    expect(lead.json.data).toMatchObject({ isLead: true, paxType: "ADT" });
    const child = await addPax(b.id, { firstName: "Omar", lastName: "Ali", dateOfBirth: "2018-06-01" });
    expect(child.json.data.paxType).toBe("CHD");
    const pax = [lead.json.data.id, child.json.data.id];

    expect((await status(b.id, fid, { status: "HELD" })).json.code).toBe("DEADLINE_REQUIRED");
    expect((await status(b.id, fid, { status: "HELD", optionDeadline: "2026-11-01T12:00:00+03:00" })).status).toBe(200);
    expect((await get(b.id)).status).toBe("ON_HOLD");
    expect((await status(b.id, fid, { status: "CONFIRMED" })).json.code).toBe("CONFIRMATION_REQUIRED");
    expect((await status(b.id, fid, { status: "CONFIRMED", pnr: "ABC123" })).status).toBe(200);
    expect((await status(b.id, hid, { status: "ISSUED", supplierConfirmation: "X" })).json.code).toBe("INVALID_STATE_TRANSITION");
    await status(b.id, hid, { status: "CONFIRMED", supplierConfirmation: "HY-7788" });

    const v1 = await get(b.id);
    expect((await call(confirm.POST as Handler, "POST", `/api/v1/bookings/${b.id}/confirm`, { cookie: A.ownerCookie, params: { id: b.id }, body: { version: v1.version - 1 } })).json.code).toBe("VERSION_CONFLICT");
    expect((await call(confirm.POST as Handler, "POST", `/api/v1/bookings/${b.id}/confirm`, { cookie: A.ownerCookie, params: { id: b.id }, body: { version: v1.version } })).json.data.status).toBe("CONFIRMED");

    // BKG-05: flight issue needs a ticket number for every passenger on it.
    await setPax(b.id, fid, pax);
    expect((await status(b.id, fid, { status: "ISSUED", tickets: [{ passengerId: pax[0], ticketNumber: "0651234567890" }] })).json.code).toBe("TICKETS_REQUIRED");
    const issued = await status(b.id, fid, { status: "ISSUED", tickets: [{ passengerId: pax[0], ticketNumber: "0651234567890" }, { passengerId: pax[1], ticketNumber: "0651234567891" }] });
    expect(issued.json.data.bookingStatus).toBe("CONFIRMED");
    expect((await status(b.id, hid, { status: "ISSUED" })).json.data.bookingStatus).toBe("ISSUED");
    const h = await prisma.bookingStatusHistory.findMany({ where: { bookingId: b.id, bookingItemId: null }, orderBy: { createdAt: "asc" } });
    expect(h.map((x) => x.toStatus)).toEqual(["DRAFT", "ON_HOLD", "DRAFT", "CONFIRMED", "CONFIRMED", "ISSUED"]);
    // Ticket numbers are unique per agency.
    const other = await newBooking();
    const ofid = (await addItem(other.id, flight())).json.data.id;
    const op = (await addPax(other.id, { firstName: "X", lastName: "Y" })).json.data.id;
    await setPax(other.id, ofid, [op]);
    await status(other.id, ofid, { status: "CONFIRMED", pnr: "ZZZ999" });
    expect((await status(other.id, ofid, { status: "ISSUED", tickets: [{ passengerId: op, ticketNumber: "0651234567890" }] })).status).toBe(409);
  });

  it("locks direct edits after confirmation (AMENDMENT_REQUIRED) and refuses to confirm without passengers", async () => {
    const b = await newBooking();
    const hid = (await addItem(b.id, hotel())).json.data.id;
    await status(b.id, hid, { status: "CONFIRMED", supplierConfirmation: "H1" });
    let v = await get(b.id);
    expect((await call(confirm.POST as Handler, "POST", `/api/v1/bookings/${b.id}/confirm`, { cookie: A.ownerCookie, params: { id: b.id }, body: { version: v.version } })).json.code).toBe("NO_PASSENGERS");
    await addPax(b.id, { travelerId });
    v = await get(b.id);
    await call(confirm.POST as Handler, "POST", `/api/v1/bookings/${b.id}/confirm`, { cookie: A.ownerCookie, params: { id: b.id }, body: { version: v.version } });
    expect((await addItem(b.id, flight())).json.code).toBe("AMENDMENT_REQUIRED");
    expect((await call(item.PATCH as Handler, "PATCH", `/api/v1/bookings/${b.id}/items/${hid}`, { cookie: A.ownerCookie, params: { id: b.id, itemId: hid }, body: { sellAmount: "1" } })).json.code).toBe("AMENDMENT_REQUIRED");
    expect((await addPax(b.id, { firstName: "Late", lastName: "Comer" })).json.code).toBe("AMENDMENT_REQUIRED");
  });

  it("links infants to one adult and keeps exactly one lead passenger", async () => {
    const b = await newBooking();
    const adult = (await addPax(b.id, { firstName: "Mom", lastName: "Ali", dateOfBirth: "1990-01-01" })).json.data.id;
    const inf = await addPax(b.id, { firstName: "Baby", lastName: "Ali", dateOfBirth: "2026-03-01", infantOfPassengerId: adult });
    expect(inf.json.data.paxType).toBe("INF");
    expect((await addPax(b.id, { firstName: "Babytwo", lastName: "Ali", dateOfBirth: "2026-03-01", infantOfPassengerId: adult })).json.code).toBe("ADULT_HAS_INFANT");
    expect((await addPax(b.id, { firstName: "Kid", lastName: "Ali", dateOfBirth: "2018-01-01", infantOfPassengerId: adult })).json.code).toBe("NOT_AN_INFANT");
    await addPax(b.id, { firstName: "Dad", lastName: "Ali", isLead: true });
    expect(await prisma.bookingPassenger.count({ where: { bookingId: b.id, isLead: true } })).toBe(1);
    const fid = (await addItem(b.id, flight())).json.data.id;
    expect((await setPax(b.id, fid, [inf.json.data.id])).json.code).toBe("INFANT_WITHOUT_ADULT");
    expect((await setPax(b.id, fid, [inf.json.data.id, adult])).status).toBe(204);
  });

  it("copies passport data from the profile encrypted and reveals it only with permission", async () => {
    const b = await newBooking();
    const p = (await addPax(b.id, { travelerId })).json.data.id;
    const row = await prisma.bookingPassenger.findUniqueOrThrow({ where: { id: p } });
    expect(row.docNumberEnc).toMatch(/^v1:/);
    expect(row.docLast4).toBe("6543");
    const view = await get(b.id);
    expect(view.passengers[0].docNumber).toBe("•••••6543");
    expect(view.text ?? JSON.stringify(view)).not.toContain("P9876543");
    expect((await call(paxReveal.POST as Handler, "POST", `/api/v1/bookings/${b.id}/passengers/${p}/reveal`, { cookie: A.ownerCookie, params: { id: b.id, passengerId: p } })).json.data.number).toBe("P9876543");
    const viewer = await addMember(A.ownerCookie, "VIEWER", [A.branchId]);
    expect((await call(paxReveal.POST as Handler, "POST", `/api/v1/bookings/${b.id}/passengers/${p}/reveal`, { cookie: viewer.cookie, params: { id: b.id, passengerId: p } })).status).toBe(403);
  });
});

describe("cancellations and amendments (BKG-14..20)", () => {
  it("keeps cancelled amounts for history and adds the fees to the totals", async () => {
    const b = await newBooking();
    const fid = (await addItem(b.id, flight())).json.data.id;
    await addItem(b.id, hotel());
    const res = await call(itemCancel.POST as Handler, "POST", `/api/v1/bookings/${b.id}/items/${fid}/cancel`, { cookie: A.ownerCookie, params: { id: b.id, itemId: fid }, body: { reason: "Customer changed plans", supplierFee: "200", agencyFee: "50", expectedSupplierRefund: "1500" } });
    expect(res.status).toBe(200);
    const v = await get(b.id);
    expect(v.items.find((i: { id: string }) => i.id === fid).sellAmount).toBe("2000");
    expect([v.sellTotal, v.taxTotal, v.grandTotal, v.costTotal]).toEqual(["3250", "0", "3250", "2700"]);
    expect((await call(itemCancel.POST as Handler, "POST", `/api/v1/bookings/${b.id}/items/${fid}/cancel`, { cookie: A.ownerCookie, params: { id: b.id, itemId: fid }, body: { reason: "again" } })).status).toBe(409);
  });

  it("cancels a whole booking and blocks further changes", async () => {
    const b = await newBooking();
    await addItem(b.id, hotel());
    const v = await get(b.id);
    const res = await call(cancelBooking.POST as Handler, "POST", `/api/v1/bookings/${b.id}/cancel`, { cookie: A.ownerCookie, params: { id: b.id }, body: { version: v.version, reason: "No longer travelling" } });
    expect(res.json.data.status).toBe("CANCELLED");
    expect((await addItem(b.id, hotel())).json.code).toBe("BOOKING_CLOSED");
  });

  it("applies an amendment atomically with fees, diff and price difference", async () => {
    const b = await newBooking();
    const hid = (await addItem(b.id, hotel())).json.data.id;
    const pid = (await addPax(b.id, { firstName: "Sarah", lastName: "Ali" })).json.data.id;
    await status(b.id, hid, { status: "CONFIRMED", supplierConfirmation: "H1" });
    let v = await get(b.id);
    await call(confirm.POST as Handler, "POST", `/api/v1/bookings/${b.id}/confirm`, { cookie: A.ownerCookie, params: { id: b.id }, body: { version: v.version } });
    const a = await call(amendments.POST as Handler, "POST", `/api/v1/bookings/${b.id}/amendments`, {
      cookie: A.ownerCookie, params: { id: b.id },
      body: { reason: "Extend stay and fix name", supplierFee: "100", agencyFee: "50", operations: [
        { op: "updateItem", itemId: hid, changes: { sellAmount: "3400", details: { ...hotel().details, checkOut: "2026-12-10" } } },
        { op: "updatePassenger", passengerId: pid, changes: { firstName: "Sara" } },
      ] },
    });
    expect(a.status).toBe(201);
    const applied = await call(applyAmendment.POST as Handler, "POST", `/api/v1/bookings/${b.id}/amendments/${a.json.data.id}/apply`, { cookie: A.ownerCookie, params: { id: b.id, amendmentId: a.json.data.id } });
    expect(applied.json.data).toEqual({ id: a.json.data.id, priceDifference: "550", grandTotal: "3550" });
    v = await get(b.id);
    expect(v.travelEndDate).toBe("2026-12-10");
    expect(v.passengers[0].firstName).toBe("SARA");
    expect(v.status).toBe("CONFIRMED");
    expect((await call(applyAmendment.POST as Handler, "POST", `/api/v1/bookings/${b.id}/amendments/${a.json.data.id}/apply`, { cookie: A.ownerCookie, params: { id: b.id, amendmentId: a.json.data.id } })).json.code).toBe("AMENDMENT_CLOSED");
  });

  it("rejects an amendment whose operation is invalid and leaves the booking untouched", async () => {
    const b = await newBooking();
    const hid = (await addItem(b.id, hotel())).json.data.id;
    await addPax(b.id, { travelerId });
    await status(b.id, hid, { status: "CONFIRMED", supplierConfirmation: "H1" });
    const v = await get(b.id);
    await call(confirm.POST as Handler, "POST", `/api/v1/bookings/${b.id}/confirm`, { cookie: A.ownerCookie, params: { id: b.id }, body: { version: v.version } });
    const before = await get(b.id);
    const a = await call(amendments.POST as Handler, "POST", `/api/v1/bookings/${b.id}/amendments`, { cookie: A.ownerCookie, params: { id: b.id }, body: { reason: "bad", operations: [{ op: "updateItem", itemId: hid, changes: { sellAmount: "100" } }, { op: "updateItem", itemId: hid, changes: { discountAmount: "999999" } }] } });
    const res = await call(applyAmendment.POST as Handler, "POST", `/api/v1/bookings/${b.id}/amendments/${a.json.data.id}/apply`, { cookie: A.ownerCookie, params: { id: b.id, amendmentId: a.json.data.id } });
    expect(res.json.code).toBe("DISCOUNT_TOO_HIGH");
    const after = await get(b.id);
    expect(after.grandTotal).toBe(before.grandTotal);
    expect(after.items[0].sellAmount).toBe("3000");
  });
});

describe("itinerary, search, dashboard and completion (BKG-11..13, §15.1)", () => {
  it("builds the itinerary and serves a signed public view without passport data", async () => {
    const b = await newBooking();
    await addItem(b.id, flight());
    await addItem(b.id, hotel());
    await addPax(b.id, { travelerId });
    await call(notes.POST as Handler, "POST", `/api/v1/bookings/${b.id}/notes`, { cookie: A.ownerCookie, params: { id: b.id }, body: { date: "2026-12-05", textEn: "Free day", textAr: "يوم حر" } });
    const it = await call(itinerary.GET as Handler, "GET", `/api/v1/bookings/${b.id}/itinerary`, { cookie: A.ownerCookie, params: { id: b.id } });
    expect(it.json.data.entries.map((e: { kind: string }) => e.kind)).toEqual(["FLIGHT", "CHECK_IN", "NOTE", "CHECK_OUT"]);
    const link = await call(itineraryLink.POST as Handler, "POST", `/api/v1/bookings/${b.id}/itinerary-link`, { cookie: A.ownerCookie, params: { id: b.id } });
    const token = link.json.data.url.split("/itinerary/")[1];
    const pub = await publicItinerary(token, "ar");
    expect(pub!.reference).toBe(b.reference);
    expect(pub!.entries.find((e) => e.kind === "NOTE")!.title).toBe("يوم حر");
    expect(JSON.stringify(pub)).not.toMatch(/P9876543|6543|docNumber/);
    expect(await publicItinerary(token.slice(0, -2) + "xx", "en")).toBeNull();
    expect(await publicItinerary("garbage", "en")).toBeNull();
  });

  it("finds bookings by reference, PNR and passenger surname", async () => {
    const b = await newBooking();
    const fid = (await addItem(b.id, flight())).json.data.id;
    await addPax(b.id, { firstName: "Hamad", lastName: `Qahtani` });
    await status(b.id, fid, { status: "CONFIRMED", pnr: "QWE789" });
    for (const q of [b.reference, "QWE789", "qahtani"]) {
      const res = await call(search.GET as Handler, "GET", `/api/v1/search?q=${q}`, { cookie: A.ownerCookie });
      expect(res.json.data.bookings.map((x: { id: string }) => x.id), q).toContain(b.id);
    }
  });

  it("shows held deadlines and passport warnings on the dashboard", async () => {
    const b = await newBooking();
    const soon = new Date(Date.now() + 86_400_000);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const fid = (await addItem(b.id, flight("RUH", "JED", `${day(soon)}T10:00`, `${day(soon)}T11:30`))).json.data.id;
    await addPax(b.id, { travelerId }); // passport expires 2027-03-01: within 6 months of a near trip
    await status(b.id, fid, { status: "HELD", optionDeadline: new Date(Date.now() + 3_600_000).toISOString() });
    const d = (await call(dashboard.GET as Handler, "GET", "/api/v1/dashboard", { cookie: A.ownerCookie })).json.data.operations;
    expect(d.held.map((h: { id: string }) => h.id)).toContain(fid);
    expect(d.documentWarnings.map((w: { bookingId: string }) => w.bookingId)).toContain(b.id);
    expect(d.createdThisWeek).toBeGreaterThan(0);
  });

  it("completes confirmed bookings after travel ends (nightly job)", async () => {
    const b = await newBooking();
    const hid = (await addItem(b.id, { ...hotel(), details: { ...hotel().details, checkIn: "2026-01-01", checkOut: "2026-01-05" } })).json.data.id;
    await addPax(b.id, { travelerId });
    await status(b.id, hid, { status: "CONFIRMED", supplierConfirmation: "H1" });
    const v = await get(b.id);
    await call(confirm.POST as Handler, "POST", `/api/v1/bookings/${b.id}/confirm`, { cookie: A.ownerCookie, params: { id: b.id }, body: { version: v.version } });
    expect(await completeFinishedBookings()).toBeGreaterThan(0);
    expect((await get(b.id)).status).toBe("COMPLETED");
  });
});

describe("booking data scope (§4.6)", () => {
  it("lets sales agents write only their own bookings, but read their branch", async () => {
    const s1 = await addMember(A.ownerCookie, "SALES_AGENT", [A.branchId]);
    const s2 = await addMember(A.ownerCookie, "SALES_AGENT", [A.branchId]);
    const mine = await newBooking(s1.cookie);
    expect((await get(mine.id, s2.cookie)).reference).toBe(mine.reference);
    expect((await addItem(mine.id, hotel(), s2.cookie)).status).toBe(403);
    expect((await addItem(mine.id, hotel(), s1.cookie)).status).toBe(201);
    const ops = await addMember(A.ownerCookie, "OPERATIONS_AGENT", [A.branchId]);
    expect((await addItem(mine.id, hotel(), ops.cookie)).status).toBe(201); // ops: branch scope
  });
});
