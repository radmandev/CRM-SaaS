import { describe, expect, it } from "vitest";
import { addMember, call, createAgency, linkIn, login, prisma, sentTo, STRONG_PASSWORD, uniq, type Handler } from "../helpers";
import { tenantDb } from "@/server/db";
import { enqueue, runJob, tick } from "@/server/jobs";
import { fakeOutbox } from "@/server/email";
import { nextDocumentNumber } from "@/modules/tenancy/service";
import * as dashboardRoute from "@/app/api/v1/dashboard/route";
import * as branchesRoute from "@/app/api/v1/branches/route";
import * as archiveRoute from "@/app/api/v1/branches/[id]/archive/route";
import * as invitationsRoute from "@/app/api/v1/invitations/route";
import * as resendRoute from "@/app/api/v1/invitations/[id]/resend/route";
import * as revokeRoute from "@/app/api/v1/invitations/[id]/revoke/route";
import * as lookupRoute from "@/app/api/v1/invitations/lookup/route";
import * as acceptRoute from "@/app/api/v1/invitations/accept/route";
import * as numberingRoute from "@/app/api/v1/agency/numbering/route";
import * as logoRoute from "@/app/api/v1/agency/logo/route";
import * as agencyRoute from "@/app/api/v1/agency/route";
import * as auditRoute from "@/app/api/v1/audit-logs/route";
import * as healthReady from "@/app/api/health/ready/route";

describe("dashboard reads persisted data (Phase 1 AC)", () => {
  it("reflects branches, invitations and the checklist as they change in the database", async () => {
    const a = await createAgency();
    const get = async () => (await call(dashboardRoute.GET as Handler, "GET", "/api/v1/dashboard", { cookie: a.ownerCookie })).json.data;
    const d1 = await get();
    expect(d1.team).toEqual({ members: 1, pendingInvites: 0, branches: 1 });
    expect(d1.usage.users).toEqual({ used: 1, limit: 5 });
    expect(d1.checklist.find((c: { key: string }) => c.key === "team").done).toBe(false);

    await call(branchesRoute.POST as Handler, "POST", "/api/v1/branches", { cookie: a.ownerCookie, body: { code: "DMM", nameEn: "Dammam" } });
    await call(invitationsRoute.POST as Handler, "POST", "/api/v1/invitations", { cookie: a.ownerCookie, body: { email: `d-${uniq()}@example.com`, role: "VIEWER", branchIds: [a.branchId] } });
    const d2 = await get();
    expect(d2.team).toEqual({ members: 1, pendingInvites: 1, branches: 2 });
    expect(d2.usage.users.used).toBe(2);
    expect(d2.checklist.find((c: { key: string }) => c.key === "team").done).toBe(true);
    expect(d2.recentActivity.map((r: { action: string }) => r.action)).toEqual(expect.arrayContaining(["branch.created", "invitation.created"]));
  });
});

describe("plan limits (SUB-01/02)", () => {
  it("blocks the branch beyond the plan with 402 and keeps the limit under concurrency", async () => {
    const a = await createAgency(); // TRIAL: 2 branches
    const results = await Promise.all(
      ["C1", "C2", "C3", "C4"].map((code) => call(branchesRoute.POST as Handler, "POST", "/api/v1/branches", { cookie: a.ownerCookie, body: { code, nameEn: code } })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 402, 402, 402]);
    expect(results.find((r) => r.status === 402)!.json.code).toBe("PLAN_LIMIT_REACHED");
    expect(await prisma.branch.count({ where: { tenantId: a.tenantId, archivedAt: null } })).toBe(2);
  });

  it("counts pending invitations toward the user limit (AUTH-22)", async () => {
    const a = await createAgency(); // TRIAL: 5 users
    for (let i = 0; i < 4; i++)
      expect((await call(invitationsRoute.POST as Handler, "POST", "/api/v1/invitations", { cookie: a.ownerCookie, body: { email: `l${i}-${uniq()}@example.com`, role: "VIEWER", branchIds: [a.branchId] } })).status).toBe(201);
    const over = await call(invitationsRoute.POST as Handler, "POST", "/api/v1/invitations", { cookie: a.ownerCookie, body: { email: `over-${uniq()}@example.com`, role: "VIEWER", branchIds: [a.branchId] } });
    expect(over.status).toBe(402);
  });
});

describe("branches (BR-01, BR-03)", () => {
  it("never archives the last active branch or a members' primary branch", async () => {
    const a = await createAgency();
    const last = await call(archiveRoute.POST as Handler, "POST", `/api/v1/branches/${a.branchId}/archive`, { cookie: a.ownerCookie, params: { id: a.branchId } });
    expect(last.status).toBe(422);
    expect(last.json.code).toBe("LAST_BRANCH");
    await call(branchesRoute.POST as Handler, "POST", "/api/v1/branches", { cookie: a.ownerCookie, body: { code: "TWO", nameEn: "Two" } });
    const inUse = await call(archiveRoute.POST as Handler, "POST", `/api/v1/branches/${a.branchId}/archive`, { cookie: a.ownerCookie, params: { id: a.branchId } });
    expect(inUse.json.code).toBe("BRANCH_IN_USE");
  });

  it("rejects duplicate branch codes with 409", async () => {
    const a = await createAgency({ plan: "PROFESSIONAL" });
    expect((await call(branchesRoute.POST as Handler, "POST", "/api/v1/branches", { cookie: a.ownerCookie, body: { code: "HO", nameEn: "Dup" } })).status).toBe(409);
  });
});

describe("invitations (AUTH-19..23)", () => {
  const invite = (cookie: string, email: string) => call(invitationsRoute.POST as Handler, "POST", "/api/v1/invitations", { cookie, body: { email, role: "SALES_AGENT", branchIds: [] as string[] } });

  it("requires at least one branch, stores only a token hash, and invalidates the old link on resend", async () => {
    const a = await createAgency();
    const email = `r-${uniq()}@example.com`;
    expect((await invite(a.ownerCookie, email)).status).toBe(422);
    const created = await call(invitationsRoute.POST as Handler, "POST", "/api/v1/invitations", { cookie: a.ownerCookie, body: { email, role: "SALES_AGENT", branchIds: [a.branchId] } });
    expect(created.status).toBe(201);
    const oldToken = linkIn((await sentTo(email))[0], /\/invite\/[\w-]+/).split("/").pop()!;
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: created.json.data.id } });
    expect(row.tokenHash).not.toContain(oldToken);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const dup = await call(invitationsRoute.POST as Handler, "POST", "/api/v1/invitations", { cookie: a.ownerCookie, body: { email, role: "VIEWER", branchIds: [a.branchId] } });
    expect(dup.json.code).toBe("INVITATION_PENDING");

    await call(resendRoute.POST as Handler, "POST", `/api/v1/invitations/${row.id}/resend`, { cookie: a.ownerCookie, params: { id: row.id } });
    const newToken = linkIn((await sentTo(email)).at(-1)!, /\/invite\/[\w-]+/).split("/").pop()!;
    expect((await call(lookupRoute.POST as Handler, "POST", "/api/v1/invitations/lookup", { body: { token: oldToken } })).status).toBe(404);
    const look = await call(lookupRoute.POST as Handler, "POST", "/api/v1/invitations/lookup", { body: { token: newToken } });
    expect(look.json.data).toMatchObject({ email, role: "SALES_AGENT", hasAccount: false });
  });

  it("revoked and expired invitations cannot be accepted, and an invitation is single-use", async () => {
    const a = await createAgency({ plan: "PROFESSIONAL" });
    const mk = async () => {
      const email = `e-${uniq()}@example.com`;
      const r = await call(invitationsRoute.POST as Handler, "POST", "/api/v1/invitations", { cookie: a.ownerCookie, body: { email, role: "VIEWER", branchIds: [a.branchId] } });
      const token = linkIn((await sentTo(email))[0], /\/invite\/[\w-]+/).split("/").pop()!;
      return { id: r.json.data.id as string, token, email };
    };
    const accept = (token: string) => call(acceptRoute.POST as Handler, "POST", "/api/v1/invitations/accept", { body: { token, name: "N", password: STRONG_PASSWORD } });

    const revoked = await mk();
    await call(revokeRoute.POST as Handler, "POST", `/api/v1/invitations/${revoked.id}/revoke`, { cookie: a.ownerCookie, params: { id: revoked.id } });
    expect((await accept(revoked.token)).json.code).toBe("INVITATION_INVALID");

    const expired = await mk();
    await prisma.invitation.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await accept(expired.token)).json.code).toBe("INVITATION_INVALID");

    const once = await mk();
    const [r1, r2] = await Promise.all([accept(once.token), accept(once.token)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 404]);
    expect(await prisma.user.count({ where: { email: once.email } })).toBe(1);
  });

  it("existing users must log in as the invited email, then join a second agency and can switch", async () => {
    const a = await createAgency();
    const b = await createAgency();
    const email = a.ownerEmail;
    await call(invitationsRoute.POST as Handler, "POST", "/api/v1/invitations", { cookie: b.ownerCookie, body: { email, role: "ACCOUNTANT", branchIds: [b.branchId] } });
    const token = linkIn((await sentTo(email)).at(-1)!, /\/invite\/[\w-]+/).split("/").pop()!;
    expect((await call(acceptRoute.POST as Handler, "POST", "/api/v1/invitations/accept", { body: { token } })).json.code).toBe("LOGIN_REQUIRED");
    const other = await addMember(b.ownerCookie, "VIEWER", [b.branchId]);
    expect((await call(acceptRoute.POST as Handler, "POST", "/api/v1/invitations/accept", { cookie: other.cookie, body: { token } })).json.code).toBe("EMAIL_MISMATCH");
    const ok = await call(acceptRoute.POST as Handler, "POST", "/api/v1/invitations/accept", { cookie: a.ownerCookie, body: { token } });
    expect(ok.status).toBe(200);
    expect(await prisma.membership.count({ where: { userId: a.ownerUserId, status: "ACTIVE" } })).toBe(2);
    // The accepting session now points at agency B; its data is B's.
    const agency = await call(agencyRoute.GET as Handler, "GET", "/api/v1/agency", { cookie: a.ownerCookie });
    expect(agency.json.data.slug).toBe(b.slug);
    const meRoute = await import("@/app/api/v1/me/active-tenant/route");
    expect((await call(meRoute.POST as Handler, "POST", "/api/v1/me/active-tenant", { cookie: a.ownerCookie, body: { tenantId: a.tenantId } })).status).toBe(200);
    expect((await call(agencyRoute.GET as Handler, "GET", "/api/v1/agency", { cookie: a.ownerCookie })).json.data.slug).toBe(a.slug);
    // Switching to an agency without membership is refused.
    const c = await createAgency();
    expect((await call(meRoute.POST as Handler, "POST", "/api/v1/me/active-tenant", { cookie: a.ownerCookie, body: { tenantId: c.tenantId } })).status).toBe(404);
    expect(await login(a.ownerEmail)).toBeTruthy();
  });
});

describe("numbering (NUM-01..03)", () => {
  it("allocates gapless unique numbers under concurrency", async () => {
    const a = await createAgency();
    const db = tenantDb(a.tenantId);
    const numbers = await Promise.all(Array.from({ length: 20 }, () => db.$transaction((tx) => nextDocumentNumber(tx, a.tenantId, "INVOICE", new Date("2026-03-01")))));
    expect(new Set(numbers).size).toBe(20);
    expect([...numbers].sort()).toEqual(Array.from({ length: 20 }, (_, i) => `INV-2026-${String(i + 1).padStart(6, "0")}`));
  });

  it("does not consume a number when the transaction rolls back", async () => {
    const a = await createAgency();
    const db = tenantDb(a.tenantId);
    await expect(db.$transaction(async (tx) => {
      await nextDocumentNumber(tx, a.tenantId, "RECEIPT");
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(await db.$transaction((tx) => nextDocumentNumber(tx, a.tenantId, "RECEIPT"))).toMatch(/-000001$/);
  });

  it("locks a prefix once its series is used", async () => {
    const a = await createAgency();
    const patch = (prefixes: Record<string, string>) => call(numberingRoute.PATCH as Handler, "PATCH", "/api/v1/agency/numbering", { cookie: a.ownerCookie, body: { prefixes } });
    expect((await patch({ BOOKING: "TRV" })).status).toBe(200);
    await tenantDb(a.tenantId).$transaction((tx) => nextDocumentNumber(tx, a.tenantId, "BOOKING"));
    const locked = await patch({ BOOKING: "XX" });
    expect(locked.json.code).toBe("PREFIX_LOCKED");
    expect((await patch({ QUOTATION: "OFR" })).status).toBe(200);
  });
});

describe("audit log (AUD-01..04)", () => {
  it("records settings changes with actor and field diff, and is append-only in the database", async () => {
    const a = await createAgency();
    const agency = (await call(agencyRoute.GET as Handler, "GET", "/api/v1/agency", { cookie: a.ownerCookie })).json.data;
    const { slug: _s, status: _st, trialEndsAt: _t, ...body } = agency;
    const res = await call(agencyRoute.PATCH as Handler, "PATCH", "/api/v1/agency", { cookie: a.ownerCookie, body: { ...body, addressCity: "Riyadh", crNumber: "1010123456" } });
    expect(res.status).toBe(200);
    const logs = await call(auditRoute.GET as Handler, "GET", "/api/v1/audit-logs?q=settings", { cookie: a.ownerCookie });
    expect(logs.json.data[0]).toMatchObject({ action: "tenant.settings_updated", actorId: a.ownerUserId, changes: { addressCity: [null, "Riyadh"], crNumber: [null, "1010123456"] } });
    await expect(prisma.auditLog.updateMany({ where: { tenantId: a.tenantId }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.deleteMany({ where: { tenantId: a.tenantId } })).rejects.toThrow(/append-only/);
  });

  it("validates KSA formats server-side (KSA-08)", async () => {
    const a = await createAgency();
    const agency = (await call(agencyRoute.GET as Handler, "GET", "/api/v1/agency", { cookie: a.ownerCookie })).json.data;
    const { slug: _s, status: _st, trialEndsAt: _t, ...body } = agency;
    const res = await call(agencyRoute.PATCH as Handler, "PATCH", "/api/v1/agency", { cookie: a.ownerCookie, body: { ...body, vatRegistered: true, vatNumber: "123456789012345", primaryColor: "#ffff00" } });
    expect(res.status).toBe(422);
    expect(res.json.errors.map((e: { path: string }) => e.path).sort()).toEqual(["primaryColor", "vatNumber"]);
  });
});

describe("logo upload (§5.3, DOC-01)", () => {
  const png = new Uint8Array(Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a8f30000000049454e44ae426082", "hex"));
  const upload = (cookie: string, bytes: Uint8Array<ArrayBuffer>, name: string, type: string) => {
    const form = new FormData();
    form.set("logo", new File([bytes], name, { type }));
    const req = new Request("http://localhost:3000/api/v1/agency/logo", { method: "POST", body: form, headers: { cookie, origin: "http://localhost:3000" } });
    return logoRoute.POST(req, { params: Promise.resolve({}) });
  };

  it("accepts a real PNG, rejects a disguised file, and serves the logo only to its tenant", async () => {
    const a = await createAgency();
    const b = await createAgency();
    const fake = await upload(a.ownerCookie, new TextEncoder().encode("<script>alert(1)</script>"), "logo.png", "image/png");
    expect(fake.status).toBe(422);
    expect((await fake.json()).code).toBe("FILE_TYPE_NOT_ALLOWED");
    const ok = await upload(a.ownerCookie, png, "logo.png", "image/png");
    expect(ok.status).toBe(201);
    const doc = await prisma.document.findFirstOrThrow({ where: { tenantId: a.tenantId } });
    expect(doc.storageKey.startsWith(`tenants/${a.tenantId}/`)).toBe(true); // TEN-09
    const mine = await call(logoRoute.GET as Handler, "GET", "/api/v1/agency/logo", { cookie: a.ownerCookie });
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("image/png");
    expect((await call(logoRoute.GET as Handler, "GET", "/api/v1/agency/logo", { cookie: b.ownerCookie })).status).toBe(404);
  });
});

describe("background jobs (JOB-01..06)", () => {
  it("delivers emails, then drops one-time links from the stored payload", async () => {
    const to = `job-${uniq()}@example.com`;
    await enqueue(prisma, "email.send", { to, subject: "S", text: "secret-link", html: "<p>secret-link</p>" });
    const job = await prisma.job.findFirstOrThrow({ where: { payload: { path: ["to"], equals: to } } });
    await runJob({ ...job, attempts: 1 });
    const done = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("SUCCEEDED");
    expect(JSON.stringify(done.payload)).not.toContain("secret-link");
    expect(fakeOutbox.some((e) => e.to === to)).toBe(true);
  });

  it("retries with backoff and marks the job DEAD after maxAttempts", async () => {
    await enqueue(prisma, "email.send", {}, { maxAttempts: 2, dedupeKey: `broken-${uniq()}` }); // invalid payload → handler throws
    const job = await prisma.job.findFirstOrThrow({ where: { maxAttempts: 2, status: "QUEUED" }, orderBy: { createdAt: "desc" } });
    // Fake provider accepts anything, so force a failure through an unknown type.
    await prisma.job.update({ where: { id: job.id }, data: { type: "does.not.exist" } });
    await runJob({ ...job, type: "does.not.exist", attempts: 1 });
    const retry = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(retry.status).toBe("QUEUED");
    expect(retry.runAt.getTime()).toBeGreaterThan(Date.now() + 10_000);
    await runJob({ ...retry, attempts: 2 });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("DEAD");
  });

  it("deduplicates scheduled jobs and the worker tick processes due work", async () => {
    const key = `dedupe-${uniq()}`;
    await enqueue(prisma, "maintenance.cleanup", {}, { dedupeKey: key });
    await enqueue(prisma, "maintenance.cleanup", {}, { dedupeKey: key });
    expect(await prisma.job.count({ where: { dedupeKey: key } })).toBe(1);
    expect(await tick(`test-${uniq()}`, 50)).toBeGreaterThan(0);
  });
});

describe("health", () => {
  it("reports database, migrations and storage", async () => {
    const res = await healthReady.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", checks: { database: true, migrations: true, storage: true } });
  });
});
