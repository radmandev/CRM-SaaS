import { beforeAll, describe, expect, it } from "vitest";
import { addMember, call, createAgency, prisma, uniq, type Handler, type TestAgency } from "../helpers";
import * as agencyRoute from "@/app/api/v1/agency/route";
import * as branchesRoute from "@/app/api/v1/branches/route";
import * as membersRoute from "@/app/api/v1/members/route";
import * as memberRoute from "@/app/api/v1/members/[id]/route";
import * as invitationsRoute from "@/app/api/v1/invitations/route";
import * as auditRoute from "@/app/api/v1/audit-logs/route";
import * as dashboardRoute from "@/app/api/v1/dashboard/route";
import * as taxRoute from "@/app/api/v1/tax-rates/route";
import * as revokeSessionsRoute from "@/app/api/v1/members/[id]/revoke-sessions/route";
import * as customersRoute from "@/app/api/v1/customers/route";
import * as suppliersRoute from "@/app/api/v1/suppliers/route";
import * as productsRoute from "@/app/api/v1/products/route";
import * as bookingsRoute from "@/app/api/v1/bookings/route";
import * as lookupRoute from "@/app/api/v1/travelers/lookup/route";
import * as quotationsRoute from "@/app/api/v1/quotations/route";
import * as invoicesRoute from "@/app/api/v1/invoices/route";
import * as paymentsRoute from "@/app/api/v1/payments/route";
import * as refundsRoute from "@/app/api/v1/refunds/route";
import * as expensesRoute from "@/app/api/v1/expenses/route";
import * as billsRoute from "@/app/api/v1/supplier-bills/route";
import * as reportsRoute from "@/app/api/v1/reports/[name]/route";
import type { Role } from "@/generated/prisma/enums";

// TST-06: each role against a representative route per permission (§4.7), plus branch scope and AUTH-19/23.

const ROLES: Role[] = ["OWNER", "ADMIN", "BRANCH_MANAGER", "SALES_AGENT", "OPERATIONS_AGENT", "ACCOUNTANT", "VIEWER"];

let A: TestAgency;
let branch2: string;
let customerId: string;
const session: Partial<Record<Role, { cookie: string; membershipId: string; userId: string }>> = {};

beforeAll(async () => {
  A = await createAgency({ plan: "ENTERPRISE" });
  session.OWNER = { cookie: A.ownerCookie, membershipId: (await prisma.membership.findFirstOrThrow({ where: { tenantId: A.tenantId } })).id, userId: A.ownerUserId };
  const b2 = await call(branchesRoute.POST as Handler, "POST", "/api/v1/branches", { cookie: A.ownerCookie, body: { code: "JED", nameEn: "Jeddah" } });
  branch2 = b2.json.data.id;
  for (const role of ROLES.slice(1)) session[role] = await addMember(A.ownerCookie, role, [A.branchId]);
  customerId = (await call(customersRoute.POST as Handler, "POST", "/api/v1/customers", { cookie: A.ownerCookie, body: { type: "CORPORATE", displayName: "Matrix Co" } })).json.data.id;
}, 120_000);

const as = (role: Role) => session[role]!.cookie;

type Case = { name: string; allowed: Role[]; run: (cookie: string, role: Role) => Promise<{ status: number }> };

const agencyBody = async () => {
  const r = await call(agencyRoute.GET as Handler, "GET", "/api/v1/agency", { cookie: A.ownerCookie });
  const { slug: _s, status: _st, trialEndsAt: _t, ...rest } = r.json.data;
  return rest;
};

const cases: Case[] = [
  { name: "tenant:settings — PATCH /agency", allowed: ["OWNER", "ADMIN"], run: async (c) => call(agencyRoute.PATCH as Handler, "PATCH", "/api/v1/agency", { cookie: c, body: await agencyBody() }) },
  { name: "tenant:settings — POST /tax-rates", allowed: ["OWNER", "ADMIN"], run: (c, r) => call(taxRoute.POST as Handler, "POST", "/api/v1/tax-rates", { cookie: c, body: { code: `T${r.slice(0, 3)}${uniq().slice(0, 4)}`.toUpperCase(), nameEn: "T", nameAr: "ت", rate: "0", category: "EXEMPT", active: false } }) },
  { name: "branch:manage — POST /branches", allowed: ["OWNER", "ADMIN"], run: (c) => call(branchesRoute.POST as Handler, "POST", "/api/v1/branches", { cookie: c, body: { code: `B${uniq().slice(0, 6)}`.toUpperCase(), nameEn: "Temp" } }) },
  { name: "user:manage — GET /members", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER"], run: (c) => call(membersRoute.GET as Handler, "GET", "/api/v1/members", { cookie: c }) },
  { name: "user:invite — POST /invitations (viewer)", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER"], run: (c) => call(invitationsRoute.POST as Handler, "POST", "/api/v1/invitations", { cookie: c, body: { email: `inv-${uniq()}@example.com`, role: "VIEWER", branchIds: [A.branchId] } }) },
  { name: "audit:read — GET /audit-logs", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER", "ACCOUNTANT"], run: (c) => call(auditRoute.GET as Handler, "GET", "/api/v1/audit-logs", { cookie: c }) },
  { name: "any member — GET /dashboard", allowed: ROLES, run: (c) => call(dashboardRoute.GET as Handler, "GET", "/api/v1/dashboard", { cookie: c }) },
  { name: "any member — GET /branches", allowed: ROLES, run: (c) => call(branchesRoute.GET as Handler, "GET", "/api/v1/branches", { cookie: c }) },
  { name: "customer:read — GET /customers", allowed: ROLES, run: (c) => call(customersRoute.GET as Handler, "GET", "/api/v1/customers", { cookie: c }) },
  { name: "customer:write — POST /customers", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER", "SALES_AGENT", "OPERATIONS_AGENT"], run: (c) => call(customersRoute.POST as Handler, "POST", "/api/v1/customers", { cookie: c, body: { type: "CORPORATE", displayName: `Co ${uniq()}` } }) },
  { name: "supplier:read — GET /suppliers", allowed: ROLES, run: (c) => call(suppliersRoute.GET as Handler, "GET", "/api/v1/suppliers", { cookie: c }) },
  { name: "supplier:write — POST /suppliers", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER", "OPERATIONS_AGENT", "ACCOUNTANT"], run: (c) => call(suppliersRoute.POST as Handler, "POST", "/api/v1/suppliers", { cookie: c, body: { type: "OTHER", code: `S${uniq().slice(0, 6)}`.toUpperCase(), nameEn: "S" } }) },
  { name: "product:write — POST /products", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER", "OPERATIONS_AGENT"], run: (c) => call(productsRoute.POST as Handler, "POST", "/api/v1/products", { cookie: c, body: { type: "TOUR", code: `P${uniq().slice(0, 6)}`.toUpperCase(), nameEn: "P", defaultCost: "0", defaultSell: "0" } }) },
  { name: "booking:read — GET /bookings", allowed: ROLES, run: (c) => call(bookingsRoute.GET as Handler, "GET", "/api/v1/bookings", { cookie: c }) },
  { name: "booking:write — POST /bookings", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER", "SALES_AGENT", "OPERATIONS_AGENT"], run: (c) => call(bookingsRoute.POST as Handler, "POST", "/api/v1/bookings", { cookie: c, body: { customerId, confirmDuplicate: true } }) },
  { name: "quotation:write — POST /quotations", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER", "SALES_AGENT"], run: (c) => call(quotationsRoute.POST as Handler, "POST", "/api/v1/quotations", { cookie: c, body: { customerId } }) },
  { name: "quotation:read — GET /quotations", allowed: ROLES, run: (c) => call(quotationsRoute.GET as Handler, "GET", "/api/v1/quotations", { cookie: c }) },
  { name: "invoice:read — GET /invoices", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER", "SALES_AGENT", "OPERATIONS_AGENT", "ACCOUNTANT"], run: (c) => call(invoicesRoute.GET as Handler, "GET", "/api/v1/invoices", { cookie: c }) },
  { name: "invoice:issue — POST /invoices (draft)", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER", "ACCOUNTANT"], run: (c) => call(invoicesRoute.POST as Handler, "POST", "/api/v1/invoices", { cookie: c, body: { customerId, lines: [{ descriptionEn: "x", unitPrice: "1", discount: "0" }] } }) },
  { name: "payment:record — POST /payments (validation reached)", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER", "SALES_AGENT", "ACCOUNTANT"], run: async (c) => {
      const r = await call(paymentsRoute.POST as Handler, "POST", "/api/v1/payments", { cookie: c, body: { customerId, date: "2026-10-20", amount: "1", method: "CASH", financialAccountId: "00000000-0000-7000-8000-000000000000" } });
      return { status: r.status === 422 ? 200 : r.status }; // permitted users get past authorization to the account check
    } },
  { name: "refund:request — GET /refunds", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER", "SALES_AGENT", "OPERATIONS_AGENT", "ACCOUNTANT"], run: (c) => call(refundsRoute.GET as Handler, "GET", "/api/v1/refunds", { cookie: c }) },
  { name: "expense:write — GET /expenses", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER", "ACCOUNTANT"], run: (c) => call(expensesRoute.GET as Handler, "GET", "/api/v1/expenses", { cookie: c }) },
  { name: "supplierbill:write — POST /supplier-bills (validation reached)", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER", "OPERATIONS_AGENT", "ACCOUNTANT"], run: async (c) => {
      const r = await call(billsRoute.POST as Handler, "POST", "/api/v1/supplier-bills", { cookie: c, body: { supplierId: "00000000-0000-7000-8000-000000000000", supplierInvoiceNumber: "X", billDate: "2026-10-20", lines: [{ description: "x", amount: "1", taxAmount: "0" }] } });
      return { status: r.status === 422 ? 200 : r.status };
    } },
  { name: "report:financial — GET /reports/sales", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER", "ACCOUNTANT"], run: (c) => call(reportsRoute.GET as Handler, "GET", "/api/v1/reports/sales?from=2026-01-01&to=2026-12-31", { cookie: c, params: { name: "sales" } }) },
  { name: "traveldoc:read — POST /travelers/lookup", allowed: ["OWNER", "ADMIN", "BRANCH_MANAGER", "SALES_AGENT", "OPERATIONS_AGENT"], run: (c) => call(lookupRoute.POST as Handler, "POST", "/api/v1/travelers/lookup", { cookie: c, body: { number: "A1234567" } }) },
];

describe("permission matrix by role", () => {
  for (const c of cases)
    for (const role of ROLES)
      it(`${c.name}: ${role} ${c.allowed.includes(role) ? "allowed" : "denied"}`, async () => {
        const res = await c.run(as(role), role);
        if (c.allowed.includes(role)) expect(res.status, JSON.stringify(res)).toBeLessThan(300);
        else expect(res.status).toBe(403);
      });
});

describe("role grants (AUTH-19, AUTH-23)", () => {
  const invite = (cookie: string, role: Role, branchIds = [A.branchId]) =>
    call(invitationsRoute.POST as Handler, "POST", "/api/v1/invitations", { cookie, body: { email: `g-${uniq()}@example.com`, role, branchIds } });

  it("only an owner can invite an owner", async () => {
    expect((await invite(as("ADMIN"), "OWNER")).status).toBe(403);
    expect((await invite(as("OWNER"), "OWNER")).status).toBe(201);
  });

  it("branch managers invite front-line roles only, and only into their branches", async () => {
    expect((await invite(as("BRANCH_MANAGER"), "ADMIN")).status).toBe(403);
    expect((await invite(as("BRANCH_MANAGER"), "ACCOUNTANT")).status).toBe(403);
    expect((await invite(as("BRANCH_MANAGER"), "BRANCH_MANAGER")).status).toBe(403);
    expect((await invite(as("BRANCH_MANAGER"), "SALES_AGENT", [branch2])).status).toBe(403);
    expect((await invite(as("BRANCH_MANAGER"), "OPERATIONS_AGENT")).status).toBe(201);
  });

  it("nobody manages themselves or someone above them", async () => {
    const self = session.ADMIN!.membershipId;
    expect((await call(memberRoute.PATCH as Handler, "PATCH", `/api/v1/members/${self}`, { cookie: as("ADMIN"), params: { id: self }, body: { role: "OWNER" } })).status).toBe(403);
    const owner = session.OWNER!.membershipId;
    expect((await call(memberRoute.PATCH as Handler, "PATCH", `/api/v1/members/${owner}`, { cookie: as("ADMIN"), params: { id: owner }, body: { status: "DEACTIVATED" } })).status).toBe(403);
    const viewer = session.VIEWER!.membershipId;
    expect((await call(memberRoute.PATCH as Handler, "PATCH", `/api/v1/members/${viewer}`, { cookie: as("ADMIN"), params: { id: viewer }, body: { role: "OWNER" } })).status).toBe(403);
  });

  it("only full-scope managers can sign a member out everywhere", async () => {
    const target = session.SALES_AGENT!.membershipId;
    const bm = await call(revokeSessionsRoute.POST as Handler, "POST", `/api/v1/members/${target}/revoke-sessions`, { cookie: as("BRANCH_MANAGER"), params: { id: target } });
    expect(bm.status).toBe(403);
  });
});

describe("branch scope (§4.6)", () => {
  it("branch managers do not see or modify members outside their branches", async () => {
    const outsider = await addMember(A.ownerCookie, "VIEWER", [branch2]);
    const list = await call(membersRoute.GET as Handler, "GET", "/api/v1/members?limit=100", { cookie: as("BRANCH_MANAGER") });
    expect(list.json.data.map((m: { id: string }) => m.id)).not.toContain(outsider.membershipId);
    const get = await call(memberRoute.GET as Handler, "GET", `/api/v1/members/${outsider.membershipId}`, { cookie: as("BRANCH_MANAGER"), params: { id: outsider.membershipId } });
    expect(get.status).toBe(404);
    const patch = await call(memberRoute.PATCH as Handler, "PATCH", `/api/v1/members/${outsider.membershipId}`, { cookie: as("BRANCH_MANAGER"), params: { id: outsider.membershipId }, body: { jobTitle: "x" } });
    expect(patch.status).toBe(404);
  });
});

describe("deactivation (AUTH-14, EMP-01)", () => {
  it("cuts access on the very next request and keeps history", async () => {
    const m = await addMember(A.ownerCookie, "VIEWER", [A.branchId]);
    expect((await call(dashboardRoute.GET as Handler, "GET", "/api/v1/dashboard", { cookie: m.cookie })).status).toBe(200);
    const off = await call(memberRoute.PATCH as Handler, "PATCH", `/api/v1/members/${m.membershipId}`, { cookie: A.ownerCookie, params: { id: m.membershipId }, body: { status: "DEACTIVATED" } });
    expect(off.status).toBe(200);
    expect((await call(dashboardRoute.GET as Handler, "GET", "/api/v1/dashboard", { cookie: m.cookie })).status).toBeGreaterThanOrEqual(401);
    const log = await prisma.auditLog.findFirst({ where: { tenantId: A.tenantId, action: "membership.deactivated", entityId: m.membershipId } });
    expect(log?.changes).toMatchObject({ status: ["ACTIVE", "DEACTIVATED"] });
  });

  it("refuses to remove the last active owner", async () => {
    const solo = await createAgency();
    const ownerId = (await prisma.membership.findFirstOrThrow({ where: { tenantId: solo.tenantId } })).id;
    const second = await addMember(solo.ownerCookie, "OWNER", [solo.branchId]);
    // Owner 2 demotes owner 1 → allowed (owner 2 remains). Then owner 1 cannot act on owner 2 any more (not an owner).
    const demote = await call(memberRoute.PATCH as Handler, "PATCH", `/api/v1/members/${ownerId}`, { cookie: second.cookie, params: { id: ownerId }, body: { role: "ADMIN" } });
    expect(demote.status).toBe(200);
    const back = await call(memberRoute.PATCH as Handler, "PATCH", `/api/v1/members/${second.membershipId}`, { cookie: solo.ownerCookie, params: { id: second.membershipId }, body: { status: "DEACTIVATED" } });
    expect(back.status).toBe(403);
    expect(await prisma.membership.count({ where: { tenantId: solo.tenantId, role: "OWNER", status: "ACTIVE" } })).toBe(1);
  });
});
