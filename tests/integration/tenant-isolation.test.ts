import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { addMember, call, createAgency, prisma, sentTo, uniq, type Handler, type TestAgency } from "../helpers";
import * as invitationsRoute from "@/app/api/v1/invitations/route";
import * as membersRoute from "@/app/api/v1/members/route";
import * as memberRoute from "@/app/api/v1/members/[id]/route";
import { TENANT_MODELS, tenantDb, TenantScopeViolation } from "@/server/db";

// TST-05 / TEN-12: every /api/v1 route is attacked by tenant B with tenant A's ids. New routes are picked up
// automatically from the file system; an [id] route without a valid body fixture below fails the suite.

const API_DIR = join(process.cwd(), "src/app/api/v1");
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? routeFiles(p) : name === "route.ts" ? [p] : [];
  });
}

// Valid bodies so the request reaches the database lookup (validation runs first and would answer 422).
const BODIES: Record<string, unknown> = {
  "PATCH branches/[id]": { code: `H${Date.now() % 100000}`, nameEn: "Hijacked" },
  "PATCH tax-rates/[id]": { code: "HIJACK", nameEn: "Hijack", nameAr: "اختراق", rate: "0", category: "EXEMPT", active: true },
  "PATCH members/[id]": { jobTitle: "Hijacked", status: "DEACTIVATED" },
};

type Snapshot = Record<string, string>;

/** Every row tenant A owns, serialized; compared before/after the attack. */
async function snapshot(tenantId: string): Promise<Snapshot> {
  const db = tenantDb(tenantId);
  const tables = {
    tenant: await prisma.tenant.findUnique({ where: { id: tenantId } }),
    branch: await db.branch.findMany({ orderBy: { id: "asc" } }),
    membership: await db.membership.findMany({ orderBy: { id: "asc" } }),
    membershipBranch: await db.membershipBranch.findMany({ orderBy: [{ membershipId: "asc" }, { branchId: "asc" }] }),
    invitation: await db.invitation.findMany({ orderBy: { id: "asc" } }),
    taxRate: await db.taxRate.findMany({ orderBy: { id: "asc" } }),
    exchangeRate: await db.exchangeRate.findMany({ orderBy: { id: "asc" } }),
    numberSequence: await db.numberSequence.findMany({ orderBy: { series: "asc" } }),
    document: await db.document.findMany({ orderBy: { id: "asc" } }),
  };
  return Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, JSON.stringify(v)]));
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
    const db = tenantDb(A.tenantId);
    aIds = {
      branches: A.branchId,
      "tax-rates": (await db.taxRate.findFirstOrThrow()).id,
      members: member.membershipId,
      invitations: (await db.invitation.findFirstOrThrow({ where: { acceptedAt: null } })).id,
    };
    aSecrets = [A.tenantId, A.slug, A.ownerEmail, member.email, inviteEmail, ...Object.values(aIds)];
  });

  it("finds the routes it is supposed to attack", () => {
    expect(routeFiles(API_DIR).length).toBeGreaterThanOrEqual(15);
  });

  it("returns 404 for another tenant's ids on every [id] route and changes nothing", async () => {
    const before = await snapshot(A.tenantId);
    const checked: string[] = [];
    for (const file of routeFiles(API_DIR)) {
      const rel = relative(API_DIR, file).replace(/\/route\.ts$/, "");
      if (!rel.includes("[id]")) continue;
      const resource = rel.split("/")[0];
      const id = aIds[resource];
      expect(id, `no tenant-A id fixture for ${rel}`).toBeDefined();
      const mod = (await import(file)) as Record<string, Handler>;
      for (const method of METHODS) {
        if (!mod[method]) continue;
        const key = `${method} ${rel}`;
        const body = method === "GET" ? undefined : (BODIES[key] ?? (rel.endsWith("[id]") ? undefined : {}));
        if (method !== "GET" && rel.endsWith("[id]")) expect(BODIES[key], `add a valid body fixture for ${key}`).toBeDefined();
        const res = await call(mod[method], method, `/api/v1/${rel.replace("[id]", id)}`, { cookie: B.ownerCookie, params: { id }, body });
        expect(res.status, `${key} → ${res.status} ${res.text}`).toBe(404);
        for (const s of aSecrets) expect(res.text).not.toContain(s);
        checked.push(key);
      }
    }
    expect(checked.length).toBeGreaterThanOrEqual(10);
    expect(await snapshot(A.tenantId)).toEqual(before);
  });

  it("never returns tenant A's data from list and singleton routes, and B's writes never land in A", async () => {
    const before = await snapshot(A.tenantId);
    for (const file of routeFiles(API_DIR)) {
      const rel = relative(API_DIR, file).replace(/\/route\.ts$/, "");
      if (rel.includes("[id]")) continue;
      const mod = (await import(file)) as Record<string, Handler>;
      if (!mod.GET) continue;
      const res = await call(mod.GET, "GET", `/api/v1/${rel}`, { cookie: B.ownerCookie });
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

  it("TENANT_MODELS lists every schema model with a tenantId column", async () => {
    const { readFileSync } = await import("node:fs");
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const withTenant = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].filter(([, , body]) => /^\s+tenantId\s/m.test(body)).map(([, name]) => name);
    const globalQueue = ["Job"]; // worker-owned queue; tenantId is metadata, jobs re-scope via tenantDb (TEN-08)
    expect(withTenant.filter((m) => !globalQueue.includes(m)).sort()).toEqual([...TENANT_MODELS].sort());
  });
});
