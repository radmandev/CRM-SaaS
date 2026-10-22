import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { addMember, call, createAgency, prisma, randomUUID, sentTo, uniq, type Handler, type TestAgency } from "../helpers";
import * as invitationsRoute from "@/app/api/v1/invitations/route";
import * as membersRoute from "@/app/api/v1/members/route";
import * as memberRoute from "@/app/api/v1/members/[id]/route";
import { readFileSync } from "node:fs";
import { GLOBAL_MODELS, tenantDb, TenantScopeViolation } from "@/server/db";

// TST-05 / TEN-12: every /api/v1 route is attacked by tenant B with tenant A's ids. New routes are picked up
// automatically from the file system; an [id] route without a valid body fixture below fails the suite.

const API_DIR = join(process.cwd(), "src/app/api/v1");
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

/** Customer, traveler, document, supplier, product, booking (+ item, passenger, amendment, note) in tenant A. */
async function seedPhase2(A: TestAgency) {
  const r = (h: Handler, method: string, path: string, params: Record<string, string>, body: unknown) => call(h, method, path, { cookie: A.ownerCookie, params, body }).then((x) => {
    if (x.status >= 300) throw new Error(`${path}: ${x.text}`);
    return x.json?.data;
  });
  const m = async (p: string) => (await import(`@/app/api/v1/${p}/route`)) as Record<string, Handler>;
  const customer = await r((await m("customers")).POST, "POST", "/api/v1/customers", {}, { type: "INDIVIDUAL", firstName: "Secret", lastName: `Customer${uniq()}`, email: `secret-${uniq()}@example.com` });
  const contact = await r((await m("customers/[id]/contacts")).POST, "POST", "", { id: customer.id }, { name: "Secret Contact" });
  const traveler = await r((await m("customers/[id]/travelers")).POST, "POST", "", { id: customer.id }, { firstName: "Secret", lastName: "Traveler", dateOfBirth: "1990-01-01" });
  const doc = await r((await m("travelers/[id]/documents")).POST, "POST", "", { id: traveler.id }, { type: "PASSPORT", number: "S7654321", expiryDate: "2031-01-01" });
  const supplier = await r((await m("suppliers")).POST, "POST", "/api/v1/suppliers", {}, { type: "HOTEL", code: `SEC${uniq().slice(0, 5)}`.toUpperCase(), nameEn: `Secret Supplier ${uniq()}` });
  const sContact = await r((await m("suppliers/[id]/contacts")).POST, "POST", "", { id: supplier.id }, { name: "Secret Supplier Contact" });
  const rule = await r((await m("suppliers/[id]/commission-rules")).POST, "POST", "", { id: supplier.id }, { kind: "PERCENT", ratePercent: "5" });
  const product = await r((await m("products")).POST, "POST", "/api/v1/products", {}, { type: "TOUR", code: `T${uniq().slice(0, 5)}`.toUpperCase(), nameEn: `Secret Tour ${uniq()}`, defaultCost: "1", defaultSell: "2" });
  const booking = await r((await m("bookings")).POST, "POST", "/api/v1/bookings", {}, { customerId: customer.id });
  const item = await r((await m("bookings/[id]/items")).POST, "POST", "", { id: booking.id }, { ...hotelItemFor(supplier.id) });
  const pax = await r((await m("bookings/[id]/passengers")).POST, "POST", "", { id: booking.id }, { travelerId: traveler.id });
  const note = await r((await m("bookings/[id]/notes")).POST, "POST", "", { id: booking.id }, { date: "2026-12-01", textEn: "Secret note" });
  // A confirmed booking with a draft amendment.
  const b2 = await r((await m("bookings")).POST, "POST", "/api/v1/bookings", {}, { customerId: customer.id, confirmDuplicate: true });
  const i2 = await r((await m("bookings/[id]/items")).POST, "POST", "", { id: b2.id }, hotelItemFor(supplier.id));
  await r((await m("bookings/[id]/passengers")).POST, "POST", "", { id: b2.id }, { travelerId: traveler.id });
  await r((await m("bookings/[id]/items/[itemId]/status")).POST, "POST", "", { id: b2.id, itemId: i2.id }, { status: "CONFIRMED", supplierConfirmation: "C1" });
  const v = (await prisma.booking.findUniqueOrThrow({ where: { id: b2.id } })).version;
  await r((await m("bookings/[id]/confirm")).POST, "POST", "", { id: b2.id }, { version: v });
  const amendment = await r((await m("bookings/[id]/amendments")).POST, "POST", "", { id: b2.id }, { reason: "secret", operations: [{ op: "updateItem", itemId: i2.id, changes: { sellAmount: "9" } }] });
  const bookingRef = (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).reference;
  const f = await seedPhase3(A, customer.id, supplier.id, booking.id, r, m);
  return {
    ids: {
      customers: customer.id, "customers:contactId": contact.id, travelers: traveler.id, "travel-documents": doc.id,
      suppliers: supplier.id, "suppliers:contactId": sContact.id, "suppliers:ruleId": rule.id, products: product.id,
      bookings: booking.id, "bookings:itemId": item.id, "bookings:passengerId": pax.id, "bookings:noteId": note.id, "bookings:amendmentId": amendment.id,
      ...f.ids,
    },
    secrets: [...f.secrets, "Secret Customer".slice(0, 6) + "", bookingRef, "S7654321", "Secret Supplier", "Secret Tour", "Secret note", "SECRET"].filter((x) => x.length > 6),
  };
}
type R = (h: Handler, method: string, path: string, params: Record<string, string>, body: unknown) => Promise<any>;
type M = (p: string) => Promise<Record<string, Handler>>;

/** Quotation (+item), draft and issued invoices (+line), payment, refund, supplier bill and payment, expense, document. */
async function seedPhase3(A: TestAgency, customerId: string, supplierId: string, bookingId: string, r: R, m: M) {
  await prisma.tenant.update({ where: { id: A.tenantId }, data: { vatRegistered: true, vatNumber: "300000000000003", crNumber: "1010123456", addressBuilding: "1234", addressStreet: "S", addressCity: "Riyadh", addressPostalCode: "12345" } });
  const tour = { serviceType: "TOUR", sellAmount: "100", details: { name: "Secret Quote Tour", date: "2026-12-01" } };
  const q = await r((await m("quotations")).POST, "POST", "", {}, { customerId });
  const qi = await r((await m("quotations/[id]/items")).POST, "POST", "", { id: q.id }, tour);
  const bank = (await prisma.financialAccount.findFirstOrThrow({ where: { tenantId: A.tenantId, type: "BANK" } })).id;
  const issued = await r((await m("invoices")).POST, "POST", "", {}, { customerId, lines: [{ descriptionEn: "Secret invoice line", unitPrice: "1000", discount: "0" }] });
  await r((await m("invoices/[id]/issue")).POST, "POST", "", { id: issued.id }, undefined);
  const draft = await r((await m("invoices")).POST, "POST", "", {}, { bookingId });
  const line = await prisma.invoiceLine.findFirstOrThrow({ where: { invoiceId: draft.id } });
  const pay = await r((await m("payments")).POST, "POST", "", {}, { customerId, date: "2026-10-20", amount: "1500", method: "BANK_TRANSFER", financialAccountId: bank, reference: "SECRET-REF", allocations: [{ invoiceId: issued.id, amount: "1000" }] });
  const refund = await r((await m("refunds")).POST, "POST", "", {}, { customerId, amount: "100", method: "BANK_TRANSFER", reason: "Secret refund" });
  const bill = await r((await m("supplier-bills")).POST, "POST", "", {}, { supplierId, supplierInvoiceNumber: "SECRET-BILL-1", billDate: "2026-10-20", lines: [{ description: "Secret bill", amount: "50", taxAmount: "0" }] });
  const sp = await r((await m("supplier-payments")).POST, "POST", "", {}, { supplierId, date: "2026-10-20", amount: "50", currency: "SAR", method: "BANK_TRANSFER", financialAccountId: bank });
  const cat = (await prisma.expenseCategory.findFirstOrThrow({ where: { tenantId: A.tenantId } })).id;
  const exp = await r((await m("expenses")).POST, "POST", "", {}, { date: "2026-10-20", categoryId: cat, description: "Secret expense", amount: "9000", taxAmount: "0", financialAccountId: bank });
  const doc = await prisma.document.create({ data: { tenantId: A.tenantId, storageKey: `tenants/${A.tenantId}/generated/invoice/${randomUUID()}.pdf`, filename: "secret.pdf", mimeType: "application/pdf", size: 10, sha256: "0".repeat(64), category: "INVOICE", entityType: "Invoice", entityId: issued.id, uploadedById: A.ownerUserId, generated: true } });
  const invNo = (await prisma.invoice.findUniqueOrThrow({ where: { id: issued.id } })).number!;
  return {
    ids: {
      quotations: q.id, "quotations:itemId": qi.id, invoices: draft.id, "invoices:lineId": line.id, payments: pay.id, refunds: refund.id,
      "supplier-bills": bill.id, "supplier-payments": sp.id, expenses: exp.id, documents: doc.id,
    },
    secrets: ["Secret Quote Tour", "Secret invoice line", "SECRET-REF", "SECRET-BILL-1", "Secret expense", invNo],
  };
}

const hotelItemFor = (supplierId: string) => ({ serviceType: "HOTEL", supplierId, sellAmount: "100", details: { hotelName: "Secret Hotel", city: "Riyadh", checkIn: "2026-12-01", checkOut: "2026-12-03", rooms: [{ roomType: "Std" }] } });

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? routeFiles(p) : name === "route.ts" ? [p] : [];
  });
}

// Valid bodies so the request reaches the database lookup (validation runs first and would answer 422).
// Every non-GET route with path parameters needs an entry; `null` means "send no body".
const hotelItem = { serviceType: "HOTEL", sellAmount: "1", details: { hotelName: "H", city: "C", checkIn: "2026-12-01", checkOut: "2026-12-02", rooms: [{ roomType: "R" }] } };
const BODIES: Record<string, unknown> = {
  "PATCH branches/[id]": { code: `H${Date.now() % 100000}`, nameEn: "Hijacked" },
  "POST branches/[id]/archive": null,
  "POST branches/[id]/restore": null,
  "PATCH tax-rates/[id]": { code: "HIJACK", nameEn: "Hijack", nameAr: "اختراق", rate: "0", category: "EXEMPT", active: true },
  "PATCH members/[id]": { jobTitle: "Hijacked", status: "DEACTIVATED" },
  "POST members/[id]/revoke-sessions": null,
  "POST invitations/[id]/resend": null,
  "POST invitations/[id]/revoke": null,
  "PATCH customers/[id]": { type: "CORPORATE", displayName: "Hijacked", version: 1 },
  "POST customers/[id]/archive": null,
  "POST customers/[id]/restore": null,
  "POST customers/[id]/merge": { intoCustomerId: "00000000-0000-7000-8000-000000000000" },
  "POST customers/[id]/contacts": { name: "Hijack" },
  "PATCH customers/[id]/contacts/[contactId]": { name: "Hijack" },
  "DELETE customers/[id]/contacts/[contactId]": null,
  "POST customers/[id]/travelers": { firstName: "Hi", lastName: "Jack" },
  "POST customers/[id]/interactions": { channel: "NOTE", direction: "OUT", body: "x", occurredAt: "2026-10-20T10:00:00Z" },
  "PATCH travelers/[id]": { firstName: "Hi", lastName: "Jack" },
  "POST travelers/[id]/archive": null,
  "POST travelers/[id]/documents": { type: "PASSPORT", number: "X1234567", expiryDate: "2030-01-01" },
  "PATCH travel-documents/[id]": { type: "PASSPORT", number: "X1234567", expiryDate: "2030-01-01" },
  "POST travel-documents/[id]/archive": null,
  "POST travel-documents/[id]/reveal": null,
  "PATCH suppliers/[id]": { type: "OTHER", code: "HIJACK", nameEn: "Hijacked" },
  "POST suppliers/[id]/archive": null,
  "POST suppliers/[id]/restore": null,
  "POST suppliers/[id]/reveal-iban": null,
  "POST suppliers/[id]/contacts": { name: "Hijack" },
  "PATCH suppliers/[id]/contacts/[contactId]": { name: "Hijack" },
  "DELETE suppliers/[id]/contacts/[contactId]": null,
  "POST suppliers/[id]/commission-rules": { kind: "PERCENT", ratePercent: "50" },
  "DELETE suppliers/[id]/commission-rules/[ruleId]": null,
  "PATCH products/[id]": { type: "TOUR", code: "HIJACK", nameEn: "Hijacked", defaultCost: "0", defaultSell: "0" },
  "PATCH bookings/[id]": { version: 1, notes: "hijacked" },
  "POST bookings/[id]/confirm": { version: 1 },
  "POST bookings/[id]/cancel": { version: 1, reason: "hijack" },
  "POST bookings/[id]/items": hotelItem,
  "PATCH bookings/[id]/items/[itemId]": { sellAmount: "1" },
  "DELETE bookings/[id]/items/[itemId]": null,
  "POST bookings/[id]/items/[itemId]/status": { status: "FAILED" },
  "POST bookings/[id]/items/[itemId]/cancel": { reason: "hijack" },
  "POST bookings/[id]/items/[itemId]/passengers": { passengerIds: [] },
  "POST bookings/[id]/passengers": { firstName: "Hi", lastName: "Jack" },
  "DELETE bookings/[id]/passengers/[passengerId]": null,
  "POST bookings/[id]/passengers/[passengerId]/refresh": null,
  "POST bookings/[id]/passengers/[passengerId]/reveal": null,
  "POST bookings/[id]/amendments": { reason: "hijack", operations: [{ op: "addItem", item: hotelItem }] },
  "POST bookings/[id]/amendments/[amendmentId]/apply": null,
  "POST bookings/[id]/amendments/[amendmentId]/cancel": null,
  "POST bookings/[id]/itinerary-link": null,
  "POST bookings/[id]/notes": { date: "2026-12-01", textEn: "hijack" },
  "DELETE bookings/[id]/notes/[noteId]": null,
  "PATCH quotations/[id]": { version: 1, validUntil: "2027-01-01" },
  "POST quotations/[id]/items": { serviceType: "TOUR", sellAmount: "1", details: { name: "x", date: "2026-12-01" } },
  "PATCH quotations/[id]/items/[itemId]": { sellAmount: "1" },
  "DELETE quotations/[id]/items/[itemId]": null,
  "POST quotations/[id]/approve": null,
  "POST quotations/[id]/send": { manual: true },
  "POST quotations/[id]/revise": null,
  "POST quotations/[id]/accept": { version: 1 },
  "POST quotations/[id]/reject": { version: 1, lostReason: "PRICE" },
  "POST quotations/[id]/convert": null,
  "POST quotations/[id]/link": null,
  "POST quotations/[id]/pdf": null,
  "PATCH invoices/[id]": { version: 1, type: "SIMPLIFIED" },
  "DELETE invoices/[id]": null,
  "POST invoices/[id]/lines": { descriptionEn: "x", unitPrice: "1", discount: "0" },
  "DELETE invoices/[id]/lines/[lineId]": null,
  "POST invoices/[id]/issue": null,
  "POST invoices/[id]/credit-notes": { reason: "x", lines: [{ originalLineId: "00000000-0000-7000-8000-000000000001", amount: "1" }] },
  "POST invoices/[id]/send": null,
  "POST invoices/[id]/pdf": null,
  "POST payments/[id]/allocate": { invoiceId: "00000000-0000-7000-8000-000000000001", amount: "1" },
  "POST payments/[id]/reverse": { reason: "hijack" },
  "POST payments/[id]/pdf": null,
  "POST refunds/[id]/approve": {},
  "POST refunds/[id]/reject": {},
  "POST refunds/[id]/cancel": null,
  "POST refunds/[id]/paid": { paidAt: "2026-10-20", financialAccountId: "00000000-0000-7000-8000-000000000001" },
  "POST supplier-bills/[id]/reverse": { reason: "hijack" },
  "POST supplier-payments/[id]/reverse": { reason: "hijack" },
  "POST expenses/[id]/approve": null,
  "POST expenses/[id]/reject": null,
  "POST expenses/[id]/reverse": { reason: "hijack" },
  "POST bookings/[id]/approve": null,
  "POST bookings/[id]/documents": { kind: "CONFIRMATION" },
};

// Query strings for parameterized GET routes that require them (otherwise 400 comes before the lookup).
const PARAM_QUERIES: Record<string, string> = {
  "customers/[id]/statement": "?from=2026-01-01&to=2026-12-31",
  "suppliers/[id]/statement": "?from=2026-01-01&to=2026-12-31",
};
// Path parameters that are not tenant records (e.g. a report name): those routes are tested like list routes.
const NON_RECORD_PARAMS: Record<string, Record<string, string>> = { "reports/[name]": { name: "sales" } };


type Snapshot = Record<string, string>;

const SCHEMA = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const MODELS = [...SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, name, body]) => ({ name, tenantScoped: /^\s+tenantId\s/m.test(body) }));
/** Tenant-owned models, read from the schema itself so a new model can never be missed by the snapshot. */
const TENANT_MODELS = MODELS.filter((m) => m.tenantScoped && !GLOBAL_MODELS.has(m.name)).map((m) => m.name);

/** Every row tenant A owns in every tenant-owned table, serialized; compared before/after the attack. */
async function snapshot(tenantId: string): Promise<Snapshot> {
  const db = tenantDb(tenantId) as unknown as Record<string, { findMany(): Promise<unknown[]> }>;
  const out: Snapshot = { tenant: JSON.stringify(await prisma.tenant.findUnique({ where: { id: tenantId } })) };
  for (const model of TENANT_MODELS) {
    const rows = await db[model[0].toLowerCase() + model.slice(1)].findMany();
    out[model] = JSON.stringify(rows.map((r) => JSON.stringify(r)).sort());
  }
  return out;
}

describe("tenant isolation across every API route", () => {
  let A: TestAgency;
  let B: TestAgency;
  let aIds: Record<string, string>;
  let aSecrets: string[];

  beforeAll(async () => {
    A = await createAgency({ plan: "PROFESSIONAL" });
    B = await createAgency({ plan: "PROFESSIONAL" });
    const member = await addMember(A.ownerCookie, "SALES_AGENT", [A.branchId]);
    const inviteEmail = `pending-${uniq()}@example.com`;
    await call(invitationsRoute.POST as Handler, "POST", "/api/v1/invitations", { cookie: A.ownerCookie, body: { email: inviteEmail, role: "VIEWER", branchIds: [A.branchId] } });
    await sentTo(inviteEmail);
    const f = await seedPhase2(A);
    const db = tenantDb(A.tenantId);
    // Keys: "<first path segment>" for [id], "<first segment>:<param>" for nested params.
    aIds = {
      branches: A.branchId,
      "tax-rates": (await db.taxRate.findFirstOrThrow()).id,
      members: member.membershipId,
      invitations: (await db.invitation.findFirstOrThrow({ where: { acceptedAt: null } })).id,
      ...f.ids,
    };
    aSecrets = [A.tenantId, A.slug, A.ownerEmail, member.email, inviteEmail, ...f.secrets, ...Object.values(aIds)];
  }, 120_000);

  it("finds the routes it is supposed to attack", () => {
    expect(routeFiles(API_DIR).length).toBeGreaterThanOrEqual(110);
  });

  it("returns 404 for another tenant's ids on every parameterized route and changes nothing", async () => {
    const before = await snapshot(A.tenantId);
    const checked: string[] = [];
    for (const file of routeFiles(API_DIR)) {
      const rel = relative(API_DIR, file).replace(/\/route\.ts$/, "");
      const names = [...rel.matchAll(/\[(\w+)\]/g)].map((m) => m[1]);
      if (!names.length || NON_RECORD_PARAMS[rel]) continue;
      const resource = rel.split("/")[0];
      const params: Record<string, string> = {};
      for (const name of names) {
        const id = aIds[name === "id" ? resource : `${resource}:${name}`];
        expect(id, `no tenant-A id fixture for [${name}] in ${rel}`).toBeDefined();
        params[name] = id;
      }
      const mod = (await import(file)) as Record<string, Handler>;
      for (const method of METHODS) {
        if (!mod[method]) continue;
        const key = `${method} ${rel}`;
        if (method !== "GET") expect(key in BODIES, `add a body fixture for ${key}`).toBe(true);
        const body = method === "GET" ? undefined : (BODIES[key] ?? undefined);
        const path = `/api/v1/${rel.replace(/\[(\w+)\]/g, (_, n) => params[n])}${method === "GET" ? (PARAM_QUERIES[rel] ?? "") : ""}`;
        const res = await call(mod[method], method, path, { cookie: B.ownerCookie, params, body });
        expect(res.status, `${key} → ${res.status} ${res.text}`).toBe(404);
        for (const s of aSecrets) expect(res.text, `${key} leaked ${s}`).not.toContain(s);
        checked.push(key);
      }
    }
    expect(checked.length).toBeGreaterThanOrEqual(100);
    expect(await snapshot(A.tenantId)).toEqual(before);
  });

  it("never returns tenant A's data from list and singleton routes, and B's writes never land in A", async () => {
    const before = await snapshot(A.tenantId);
    for (const file of routeFiles(API_DIR)) {
      const rel = relative(API_DIR, file).replace(/\/route\.ts$/, "");
      const fixed = NON_RECORD_PARAMS[rel];
      if (/\[\w+\]/.test(rel) && !fixed) continue;
      const mod = (await import(file)) as Record<string, Handler>;
      if (!mod.GET) continue;
      // Searches use words that only exist in tenant A's data.
      const query = {
        search: "?q=Secret", "reference/airports": "?q=Riyadh", customers: "?q=Secret", suppliers: "?q=Secret", products: "?q=Secret", bookings: "?q=Secret",
        quotations: "?q=Secret", invoices: "?q=Secret", payments: "?q=Secret", "supplier-bills": "?q=Secret", expenses: "?q=Secret", "reports/[name]": "?from=2026-01-01&to=2026-12-31",
      }[rel] ?? "";
      const path = `/api/v1/${rel.replace(/\[(\w+)\]/g, (_, n) => fixed?.[n] ?? n)}${query}`;
      const res = await call(mod.GET, "GET", path, { cookie: B.ownerCookie, params: fixed ?? {} });
      expect([200, 404], `${rel} → ${res.status}`).toContain(res.status);
      for (const s of aSecrets) expect(res.text, `GET ${rel} leaked ${s}`).not.toContain(s);
    }
    expect(await snapshot(A.tenantId)).toEqual(before);
  });

  it("ignores tenantId smuggled in bodies and rejects references to A's branches", async () => {
    const before = await snapshot(A.tenantId);
    // tenantId in a body is not part of any schema and is dropped; the branch lands in B.
    const branches = await import("@/app/api/v1/branches/route");
    const created = await call(branches.POST as Handler, "POST", "/api/v1/branches", { cookie: B.ownerCookie, body: { code: "SMUG1", nameEn: "Smuggled", tenantId: A.tenantId } });
    expect(created.status).toBe(201);
    expect(created.json.data.tenantId).toBe(B.tenantId);

    // Inviting into, or assigning, tenant A's branch is rejected.
    const inv = await call(invitationsRoute.POST as Handler, "POST", "/api/v1/invitations", { cookie: B.ownerCookie, body: { email: `x-${uniq()}@example.com`, role: "VIEWER", branchIds: [A.branchId] } });
    expect(inv.status).toBe(422);
    const bMember = await addMember(B.ownerCookie, "VIEWER", [B.branchId]);
    const patch = await call(memberRoute.PATCH as Handler, "PATCH", `/api/v1/members/${bMember.membershipId}`, { cookie: B.ownerCookie, params: { id: bMember.membershipId }, body: { branchIds: [A.branchId], primaryBranchId: A.branchId } });
    expect(patch.status).toBe(422);
    expect(await snapshot(A.tenantId)).toEqual(before);
  });

  it("does not let tenant B list A's members by any query parameter", async () => {
    const res = await call(membersRoute.GET as Handler, "GET", `/api/v1/members?q=${encodeURIComponent(A.ownerEmail)}`, { cookie: B.ownerCookie });
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual([]);
    const smuggled = await call(membersRoute.GET as Handler, "GET", `/api/v1/members?tenantId=${A.tenantId}`, { cookie: B.ownerCookie });
    expect(smuggled.status).toBe(400); // unknown query parameters are rejected (API-06)
  });
});

describe("tenantDb scoping (TEN-03) and database guards (TEN-05)", () => {
  let A: TestAgency;
  let B: TestAgency;
  beforeAll(async () => {
    A = await createAgency();
    B = await createAgency();
  });

  it("scopes reads, updates and deletes to the tenant", async () => {
    const db = tenantDb(A.tenantId);
    expect((await db.branch.findMany()).every((b) => b.tenantId === A.tenantId)).toBe(true);
    expect(await db.branch.findUnique({ where: { id: B.branchId } })).toBeNull();
    expect(await db.branch.findFirst({ where: { id: B.branchId } })).toBeNull();
    await expect(db.branch.update({ where: { id: B.branchId }, data: { nameEn: "x" } })).rejects.toMatchObject({ code: "P2025" });
    expect((await db.branch.updateMany({ where: { id: B.branchId }, data: { nameEn: "x" } })).count).toBe(0);
    expect((await db.branch.deleteMany({ where: { id: B.branchId } })).count).toBe(0);
    await expect(db.tenant.findUnique({ where: { id: B.tenantId } })).rejects.toBeInstanceOf(TenantScopeViolation);
    expect((await prisma.branch.findUniqueOrThrow({ where: { id: B.branchId } })).nameEn).toBe("Head Office");
  });

  it("throws when a caller passes another tenant's id explicitly", async () => {
    const db = tenantDb(A.tenantId);
    await expect(db.branch.create({ data: { tenantId: B.tenantId, code: "EVIL", nameEn: "Evil" } })).rejects.toBeInstanceOf(TenantScopeViolation);
    await expect(db.branch.findMany({ where: { tenantId: B.tenantId } })).rejects.toBeInstanceOf(TenantScopeViolation);
    await expect(db.branch.updateMany({ where: {}, data: { tenantId: B.tenantId } })).rejects.toBeInstanceOf(TenantScopeViolation);
    await expect(db.tenant.delete({ where: { id: A.tenantId } })).rejects.toBeInstanceOf(TenantScopeViolation);
  });

  it("composite foreign keys reject cross-tenant references even from unscoped code", async () => {
    const m = await prisma.membership.findFirstOrThrow({ where: { tenantId: A.tenantId } });
    await expect(prisma.membership.update({ where: { id: m.id }, data: { primaryBranchId: B.branchId } })).rejects.toMatchObject({ code: "P2003" });
    await expect(prisma.membershipBranch.create({ data: { tenantId: A.tenantId, membershipId: m.id, branchId: B.branchId } })).rejects.toMatchObject({ code: "P2003" });
  });

  it("GLOBAL_MODELS is exactly the set of models without a tenantId column (plus the job queue)", () => {
    const withoutTenant = MODELS.filter((m) => !m.tenantScoped && m.name !== "Tenant").map((m) => m.name);
    expect([...GLOBAL_MODELS].sort()).toEqual([...withoutTenant, "Job"].sort());
    expect(TENANT_MODELS.length).toBeGreaterThanOrEqual(40);
  });
});
