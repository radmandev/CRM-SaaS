import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { addMember, call, createAgency, prisma, uniq, type Handler, type TestAgency } from "../helpers";
import * as customers from "@/app/api/v1/customers/route";
import * as customer from "@/app/api/v1/customers/[id]/route";
import * as travelers from "@/app/api/v1/customers/[id]/travelers/route";
import * as documents from "@/app/api/v1/travelers/[id]/documents/route";
import * as reveal from "@/app/api/v1/travel-documents/[id]/reveal/route";
import * as lookup from "@/app/api/v1/travelers/lookup/route";
import * as merge from "@/app/api/v1/customers/[id]/merge/route";
import * as contacts from "@/app/api/v1/customers/[id]/contacts/route";
import * as interactions from "@/app/api/v1/customers/[id]/interactions/route";
import * as timeline from "@/app/api/v1/customers/[id]/timeline/route";
import * as branches from "@/app/api/v1/branches/route";

let A: TestAgency;
let branch2: string;
let sales1: Awaited<ReturnType<typeof addMember>>; // branch 1
let sales2: Awaited<ReturnType<typeof addMember>>; // branch 2
let accountant: Awaited<ReturnType<typeof addMember>>;

const newCustomer = (cookie: string, over: Record<string, unknown> = {}) =>
  call(customers.POST as Handler, "POST", "/api/v1/customers", { cookie, body: { type: "INDIVIDUAL", firstName: "Sara", lastName: `Ali${uniq()}`, phone: `050${Math.floor(1_000_000 + Math.random() * 8_999_999)}`, ...over } });

beforeAll(async () => {
  A = await createAgency({ plan: "PROFESSIONAL" });
  branch2 = (await call(branches.POST as Handler, "POST", "/api/v1/branches", { cookie: A.ownerCookie, body: { code: "JED", nameEn: "Jeddah" } })).json.data.id;
  sales1 = await addMember(A.ownerCookie, "SALES_AGENT", [A.branchId]);
  sales2 = await addMember(A.ownerCookie, "SALES_AGENT", [branch2]);
  accountant = await addMember(A.ownerCookie, "ACCOUNTANT", [A.branchId]);
}, 120_000);

describe("customers (§6.1)", () => {
  it("creates with an auto code, normalized phone and tags, and audits it", async () => {
    const res = await newCustomer(sales1.cookie, { phone: "0501234567", email: "Sara@Example.com", tags: ["vip", "family"] });
    expect(res.status).toBe(201);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: res.json.data.id }, include: { tags: { include: { tag: true } } } });
    expect(c.code).toMatch(/^C-\d{6}$/);
    expect(c.phone).toBe("+966501234567");
    expect(c.email).toBe("sara@example.com");
    expect(c.displayName).toMatch(/^Sara Ali/);
    expect(c.tags.map((t) => t.tag.name).sort()).toEqual(["family", "vip"]);
    expect(await prisma.auditLog.count({ where: { entityId: c.id, action: "customer.created" } })).toBe(1);
  });

  it("warns about duplicates by phone or email and creates only when confirmed (CRM-01)", async () => {
    const first = await newCustomer(A.ownerCookie, { phone: "0559998877" });
    const dup = await newCustomer(A.ownerCookie, { phone: "+966 55 999 8877" });
    expect(dup.status).toBe(409);
    expect(dup.json.code).toBe("POSSIBLE_DUPLICATE");
    expect(dup.json.duplicates.map((d: { id: string }) => d.id)).toContain(first.json.data.id);
    expect((await newCustomer(A.ownerCookie, { phone: "+966 55 999 8877", confirmDuplicate: true })).status).toBe(201);
  });

  it("scopes by branch: agents see their branch, the owner sees all, other branches are 404", async () => {
    const c1 = (await newCustomer(sales1.cookie)).json.data.id;
    const c2 = (await newCustomer(sales2.cookie, { branchId: branch2 })).json.data.id;
    const list1 = await call(customers.GET as Handler, "GET", "/api/v1/customers?limit=100", { cookie: sales1.cookie });
    const ids1 = list1.json.data.map((c: { id: string }) => c.id);
    expect(ids1).toContain(c1);
    expect(ids1).not.toContain(c2);
    expect((await call(customer.GET as Handler, "GET", `/api/v1/customers/${c2}`, { cookie: sales1.cookie, params: { id: c2 } })).status).toBe(404);
    expect((await call(customer.GET as Handler, "GET", `/api/v1/customers/${c2}`, { cookie: A.ownerCookie, params: { id: c2 } })).status).toBe(200);
    // Creating into a branch you are not assigned to is forbidden.
    expect((await newCustomer(sales1.cookie, { branchId: branch2 })).status).toBe(403);
  });

  it("enforces optimistic locking (BKG-21 style) and read-only roles", async () => {
    const id = (await newCustomer(A.ownerCookie)).json.data.id;
    const get = await call(customer.GET as Handler, "GET", `/api/v1/customers/${id}`, { cookie: A.ownerCookie, params: { id } });
    const body = { type: "INDIVIDUAL", firstName: "Sara", lastName: "Renamed", version: get.json.data.version };
    expect((await call(customer.PATCH as Handler, "PATCH", `/api/v1/customers/${id}`, { cookie: A.ownerCookie, params: { id }, body })).status).toBe(200);
    const stale = await call(customer.PATCH as Handler, "PATCH", `/api/v1/customers/${id}`, { cookie: A.ownerCookie, params: { id }, body: { ...body, lastName: "Again" } });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe("VERSION_CONFLICT");
    expect((await call(customer.GET as Handler, "GET", `/api/v1/customers/${id}`, { cookie: accountant.cookie, params: { id } })).status).toBe(200);
    expect((await newCustomer(accountant.cookie)).status).toBe(403);
  });

  it("searches by name, code, phone and email within scope", async () => {
    const id = (await newCustomer(A.ownerCookie, { firstName: "Zainab", lastName: `Search${uniq()}`, email: `zs-${uniq()}@example.com` })).json.data.id;
    const c = await prisma.customer.findUniqueOrThrow({ where: { id } });
    for (const q of [c.lastName!.slice(0, 8), c.code, c.email!.slice(0, 6)]) {
      const res = await call(customers.GET as Handler, "GET", `/api/v1/customers?q=${encodeURIComponent(q)}`, { cookie: A.ownerCookie });
      expect(res.json.data.map((x: { id: string }) => x.id), q).toContain(id);
    }
  });
});

describe("travelers and travel documents (§6.3/6.4, CRM-07/08)", () => {
  let customerId: string;
  let travelerId: string;
  let docId: string;
  beforeAll(async () => {
    customerId = (await newCustomer(sales1.cookie)).json.data.id;
    travelerId = (await call(travelers.POST as Handler, "POST", `/api/v1/customers/${customerId}/travelers`, { cookie: sales1.cookie, params: { id: customerId }, body: { firstName: "sara", lastName: "ali", gender: "F", dateOfBirth: "1990-05-01", nationality: "SA" } })).json.data.id;
    const d = await call(documents.POST as Handler, "POST", `/api/v1/travelers/${travelerId}/documents`, { cookie: sales1.cookie, params: { id: travelerId }, body: { type: "PASSPORT", number: "a 1234567", issuingCountry: "SA", expiryDate: "2031-01-01" } });
    expect(d.status).toBe(201);
    docId = d.json.data.id;
  });

  it("stores the number encrypted (verified with direct SQL) and returns it masked", async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const { rows } = await client.query('SELECT "numberEnc", "numberHash", "numberLast4" FROM travel_document WHERE id = $1', [docId]);
    await client.end();
    expect(rows[0].numberEnc).toMatch(/^v1:k2:/);
    expect(rows[0].numberEnc).not.toContain("A1234567");
    expect(rows[0].numberHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].numberLast4).toBe("4567");
    const view = await call(customer.GET as Handler, "GET", `/api/v1/customers/${customerId}`, { cookie: sales1.cookie, params: { id: customerId } });
    expect(view.text).not.toContain("A1234567");
    expect(view.json.data.travelers[0].documents[0].number).toBe("•••••4567");
    expect(view.json.data.travelers[0].firstName).toBe("SARA"); // as in passport
  });

  it("reveals only within traveldoc:reveal scope and audits every reveal", async () => {
    const own = await call(reveal.POST as Handler, "POST", `/api/v1/travel-documents/${docId}/reveal`, { cookie: sales1.cookie, params: { id: docId } });
    expect(own.status).toBe(200);
    expect(own.json.data.number).toBe("A1234567");
    expect(own.headers.get("cache-control")).toBe("no-store");
    // Another sales agent in the same branch can read the customer but does not own it (scope OWN).
    const colleague = await addMember(A.ownerCookie, "SALES_AGENT", [A.branchId]);
    expect((await call(reveal.POST as Handler, "POST", `/api/v1/travel-documents/${docId}/reveal`, { cookie: colleague.cookie, params: { id: docId } })).status).toBe(403);
    // Accountants cannot even read masked documents.
    expect((await call(reveal.POST as Handler, "POST", `/api/v1/travel-documents/${docId}/reveal`, { cookie: accountant.cookie, params: { id: docId } })).status).toBe(403);
    const ac = await call(customer.GET as Handler, "GET", `/api/v1/customers/${customerId}`, { cookie: accountant.cookie, params: { id: customerId } });
    expect(ac.json.data.travelers[0].documents).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "traveldoc.revealed", entityId: docId } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "traveldoc.created", entityId: docId } });
    expect(JSON.stringify(audit.changes)).not.toContain("1234567");
  });

  it("finds travelers by document number without decrypting (CRM-08)", async () => {
    const res = await call(lookup.POST as Handler, "POST", "/api/v1/travelers/lookup", { cookie: sales1.cookie, body: { number: "A1234567" } });
    expect(res.json.data.map((t: { id: string }) => t.id)).toContain(travelerId);
    const other = await call(lookup.POST as Handler, "POST", "/api/v1/travelers/lookup", { cookie: sales2.cookie, body: { number: "A1234567" } });
    expect(other.json.data).toEqual([]); // outside branch scope
  });
});

describe("contacts, interactions, timeline, merge (§6.2, §6.5, CRM-03, CRM-12)", () => {
  it("keeps one primary contact", async () => {
    const id = (await newCustomer(A.ownerCookie, { type: "CORPORATE", displayName: `Acme ${uniq()}` })).json.data.id;
    for (const name of ["First", "Second"]) await call(contacts.POST as Handler, "POST", `/api/v1/customers/${id}/contacts`, { cookie: A.ownerCookie, params: { id }, body: { name, isPrimary: true } });
    const rows = await prisma.customerContact.findMany({ where: { customerId: id, isPrimary: true } });
    expect(rows.map((r) => r.name)).toEqual(["Second"]);
  });

  it("logs interactions and shows them with the audit trail on the timeline", async () => {
    const id = (await newCustomer(A.ownerCookie)).json.data.id;
    const i = await call(interactions.POST as Handler, "POST", `/api/v1/customers/${id}/interactions`, { cookie: A.ownerCookie, params: { id }, body: { channel: "CALL", direction: "IN", subject: "Asked about Bali", body: "Wants 5 nights in December", occurredAt: "2026-10-20T10:00:00+03:00" } });
    expect(i.status).toBe(201);
    const t = await call(timeline.GET as Handler, "GET", `/api/v1/customers/${id}/timeline`, { cookie: A.ownerCookie, params: { id } });
    expect(t.json.data.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(["interaction", "audit"]));
  });

  it("merges every reference into the survivor and archives the source", async () => {
    const source = (await newCustomer(A.ownerCookie, { tags: ["old"] })).json.data.id;
    const into = (await newCustomer(A.ownerCookie)).json.data.id;
    await call(travelers.POST as Handler, "POST", `/api/v1/customers/${source}/travelers`, { cookie: A.ownerCookie, params: { id: source }, body: { firstName: "Kid", lastName: "Ali" } });
    await call(interactions.POST as Handler, "POST", `/api/v1/customers/${source}/interactions`, { cookie: A.ownerCookie, params: { id: source }, body: { channel: "NOTE", direction: "OUT", body: "x", occurredAt: "2026-10-20T10:00:00Z" } });
    expect((await call(merge.POST as Handler, "POST", `/api/v1/customers/${source}/merge`, { cookie: sales1.cookie, params: { id: source }, body: { intoCustomerId: into } })).status).toBe(403);
    const res = await call(merge.POST as Handler, "POST", `/api/v1/customers/${source}/merge`, { cookie: A.ownerCookie, params: { id: source }, body: { intoCustomerId: into } });
    expect(res.status).toBe(200);
    expect(res.json.data.moved).toMatchObject({ travelers: 1, interactions: 1 });
    const s = await prisma.customer.findUniqueOrThrow({ where: { id: source } });
    expect(s.mergedIntoId).toBe(into);
    expect(s.archivedAt).not.toBeNull();
    expect(await prisma.traveler.count({ where: { customerId: into } })).toBe(1);
    expect(await prisma.customerTag.count({ where: { customerId: into } })).toBe(1);
    const again = await call(merge.POST as Handler, "POST", `/api/v1/customers/${source}/merge`, { cookie: A.ownerCookie, params: { id: source }, body: { intoCustomerId: into } });
    expect(again.status).toBe(422);
  });
});
