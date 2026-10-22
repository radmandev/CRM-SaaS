import { beforeAll, describe, expect, it } from "vitest";
import { addMember, call, createAgency, prisma, uniq, type Handler, type TestAgency } from "../helpers";
import * as customers from "@/app/api/v1/customers/route";
import * as quotations from "@/app/api/v1/quotations/route";
import * as quotation from "@/app/api/v1/quotations/[id]/route";
import * as qItems from "@/app/api/v1/quotations/[id]/items/route";
import * as qItem from "@/app/api/v1/quotations/[id]/items/[itemId]/route";
import * as approve from "@/app/api/v1/quotations/[id]/approve/route";
import * as send from "@/app/api/v1/quotations/[id]/send/route";
import * as revise from "@/app/api/v1/quotations/[id]/revise/route";
import * as accept from "@/app/api/v1/quotations/[id]/accept/route";
import * as reject from "@/app/api/v1/quotations/[id]/reject/route";
import * as convert from "@/app/api/v1/quotations/[id]/convert/route";
import * as link from "@/app/api/v1/quotations/[id]/link/route";
import * as bookings from "@/app/api/v1/bookings/route";
import * as bItems from "@/app/api/v1/bookings/[id]/items/route";
import * as bConfirm from "@/app/api/v1/bookings/[id]/confirm/route";
import * as bApprove from "@/app/api/v1/bookings/[id]/approve/route";
import * as bStatus from "@/app/api/v1/bookings/[id]/items/[itemId]/status/route";
import * as bPax from "@/app/api/v1/bookings/[id]/passengers/route";
import { expireQuotations, publicProposal } from "@/modules/sales/service";

let A: TestAgency;
let customerId: string;
let sales: Awaited<ReturnType<typeof addMember>>;
let manager: Awaited<ReturnType<typeof addMember>>;
const tour = (sell: string, discount = "0", cost = "0") => ({ serviceType: "TOUR", sellAmount: sell, discountAmount: discount, costAmount: cost, details: { name: "Diriyah evening", date: "2026-12-05" } });
const post = (h: Handler, body: unknown, cookie: string, params: Record<string, string> = {}) => call(h, "POST", "/x", { cookie, body, params });
const getQ = async (id: string, cookie = A.ownerCookie) => (await call(quotation.GET as Handler, "GET", "", { cookie, params: { id } })).json.data;

async function newQuote(cookie = sales.cookie) {
  const q = await post(quotations.POST as Handler, { customerId }, cookie);
  expect(q.status, q.text).toBe(201);
  return q.json.data.id as string;
}

beforeAll(async () => {
  A = await createAgency({ plan: "PROFESSIONAL" });
  customerId = (await call(customers.POST as Handler, "POST", "/api/v1/customers", { cookie: A.ownerCookie, body: { type: "INDIVIDUAL", firstName: "Lama", lastName: "Fahad", email: `lama-${uniq()}@example.com` } })).json.data.id;
  sales = await addMember(A.ownerCookie, "SALES_AGENT", [A.branchId]);
  manager = await addMember(A.ownerCookie, "BRANCH_MANAGER", [A.branchId]);
}, 120_000);

describe("quotations (§10.1–10.5)", () => {
  it("needs approval for a large discount; the approval is invalidated by any price change (QT-10)", async () => {
    const id = await newQuote();
    const item = (await post(qItems.POST as Handler, tour("1000", "200"), sales.cookie, { id })).json.data.id; // 20% > 10%
    let q = await getQ(id);
    expect(q.requiresApproval).toBe(true);
    expect((await post(send.POST as Handler, { manual: true }, sales.cookie, { id })).json.code).toBe("APPROVAL_REQUIRED");
    expect((await post(approve.POST as Handler, undefined, sales.cookie, { id })).status).toBe(403);
    expect((await post(approve.POST as Handler, undefined, manager.cookie, { id })).status).toBe(204);
    expect((await getQ(id)).approvedAt).not.toBeNull();
    await call(qItem.PATCH as Handler, "PATCH", "", { cookie: sales.cookie, params: { id, itemId: item }, body: { discountAmount: "250" } });
    q = await getQ(id);
    expect(q.approvedAt).toBeNull();
    // Selling below cost also needs approval.
    const id2 = await newQuote();
    await post(qItems.POST as Handler, tour("100", "0", "150"), sales.cookie, { id: id2 });
    expect((await getQ(id2)).requiresApproval).toBe(true);
  });

  it("sends with a number, revises into a new version with the same number, and expires (QT-01/02/06)", async () => {
    const id = await newQuote();
    await post(qItems.POST as Handler, tour("500"), sales.cookie, { id });
    const sent = await post(send.POST as Handler, { manual: false }, sales.cookie, { id });
    expect(sent.status, sent.text).toBe(200);
    expect(sent.json.data.number).toMatch(/^QT-\d{4}-\d{6}$/);
    expect(await prisma.job.count({ where: { tenantId: A.tenantId, type: "document.email", payload: { path: ["id"], equals: id } } })).toBe(1);
    expect((await post(qItems.POST as Handler, tour("1"), sales.cookie, { id })).json.code).toBe("QUOTATION_NOT_DRAFT");
    const v2 = await post(revise.POST as Handler, undefined, sales.cookie, { id });
    expect(v2.status).toBe(201);
    const [q1, q2] = [await getQ(id), await getQ(v2.json.data.id)];
    expect([q1.status, q2.status, q2.versionNo, q2.number]).toEqual(["SUPERSEDED", "DRAFT", 2, sent.json.data.number]); // QT-01: one number
    expect(q2.items).toHaveLength(1);
    await post(send.POST as Handler, { manual: true }, sales.cookie, { id: v2.json.data.id });
    expect((await getQ(v2.json.data.id)).number).toBe(sent.json.data.number);
    expect(q2.versions.map((v: { versionNo: number }) => v.versionNo)).toEqual([1, 2]);
    // Expiry job.
    await prisma.quotation.update({ where: { id: v2.json.data.id }, data: { validUntil: new Date("2026-01-01") } });
    expect(await expireQuotations()).toBeGreaterThan(0);
    expect((await getQ(v2.json.data.id)).status).toBe("EXPIRED");
  });

  it("is accepted and converted once into a draft booking with its services (QT-03)", async () => {
    const id = await newQuote();
    await post(qItems.POST as Handler, tour("700"), sales.cookie, { id });
    await post(send.POST as Handler, { manual: true }, sales.cookie, { id });
    let q = await getQ(id);
    expect((await post(accept.POST as Handler, { version: q.version - 1 }, sales.cookie, { id })).json.code).toBe("VERSION_CONFLICT");
    expect((await post(accept.POST as Handler, { version: q.version, note: "Customer said yes by phone" }, sales.cookie, { id })).status).toBe(204);
    const res = await post(convert.POST as Handler, undefined, sales.cookie, { id });
    expect(res.status, res.text).toBe(201);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: res.json.data.bookingId }, include: { items: true } });
    expect([b.quotationId, b.status, b.items.length, b.items[0].status, b.grandTotal.toString()]).toEqual([id, "DRAFT", 1, "REQUESTED", "700"]);
    expect((await post(convert.POST as Handler, undefined, sales.cookie, { id })).json.code).toBe("ALREADY_CONVERTED");
    q = await getQ(id);
    expect(q.status).toBe("CONVERTED");
  });

  it("records lost quotations with a reason (QT-12)", async () => {
    const id = await newQuote();
    await post(qItems.POST as Handler, tour("300"), sales.cookie, { id });
    await post(send.POST as Handler, { manual: true }, sales.cookie, { id });
    const q = await getQ(id);
    expect((await post(reject.POST as Handler, { version: q.version, lostReason: "PRICE", lostNote: "Cheaper elsewhere" }, sales.cookie, { id })).status).toBe(204);
    expect((await getQ(id)).lostReason).toBe("PRICE");
  });

  it("serves a signed customer proposal without costs, internal notes or margins (QT-05)", async () => {
    const id = await newQuote();
    await post(qItems.POST as Handler, { ...tour("900", "0", "640"), description: "Desert safari" }, sales.cookie, { id });
    await call(quotation.PATCH as Handler, "PATCH", "", { cookie: sales.cookie, params: { id }, body: { version: (await getQ(id)).version, validUntil: "2027-01-31", notes: "INTERNAL-NOTE", customerNotes: "Includes hotel pickup" } });
    expect((await post(link.POST as Handler, undefined, sales.cookie, { id })).json.code).toBe("QUOTATION_NOT_SENT");
    await post(send.POST as Handler, { manual: true }, sales.cookie, { id });
    const url = (await post(link.POST as Handler, undefined, sales.cookie, { id })).json.data.url as string;
    const p = await publicProposal(url.split("/proposal/")[1]);
    expect(p!.totals.grand).toBe("900");
    expect(p!.customerNotes).toBe("Includes hotel pickup");
    expect(JSON.stringify(p)).not.toMatch(/640|INTERNAL-NOTE|costAmount|costTotal|commission|margin/i);
    expect(await publicProposal("forged.token")).toBeNull();
  });

  it("scopes quotations: sales agents edit their own, read their branch", async () => {
    const mine = await newQuote(sales.cookie);
    const other = await addMember(A.ownerCookie, "SALES_AGENT", [A.branchId]);
    expect((await getQ(mine, other.cookie)).id).toBe(mine);
    expect((await post(qItems.POST as Handler, tour("1"), other.cookie, { id: mine })).status).toBe(403);
  });
});

describe("discount approval on bookings (QT-10)", () => {
  it("blocks confirmation until a manager approves a below-cost booking", async () => {
    const b = (await post(bookings.POST as Handler, { customerId, confirmDuplicate: true }, sales.cookie)).json.data;
    const item = (await post(bItems.POST as Handler, tour("100", "0", "180"), sales.cookie, { id: b.id })).json.data.id;
    await post(bPax.POST as Handler, { firstName: "Lama", lastName: "Fahad" }, sales.cookie, { id: b.id });
    await post(bStatus.POST as Handler, { status: "CONFIRMED", supplierConfirmation: "T-1" }, sales.cookie, { id: b.id, itemId: item });
    let v = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(v.requiresApproval).toBe(true);
    expect((await post(bConfirm.POST as Handler, { version: v.version }, sales.cookie, { id: b.id })).json.code).toBe("APPROVAL_REQUIRED");
    expect((await post(bApprove.POST as Handler, undefined, sales.cookie, { id: b.id })).status).toBe(403);
    expect((await post(bApprove.POST as Handler, undefined, manager.cookie, { id: b.id })).status).toBe(200);
    v = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect((await post(bConfirm.POST as Handler, { version: v.version }, sales.cookie, { id: b.id })).json.data.status).toBe("CONFIRMED");
  });
});
