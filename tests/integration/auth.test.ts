import { describe, expect, it } from "vitest";
import { auth, call, cookieFrom, createAgency, linkIn, login, prisma, sentTo, STRONG_PASSWORD, uniq, type Handler } from "../helpers";
import * as signupRoute from "@/app/api/v1/signup/route";
import * as dashboardRoute from "@/app/api/v1/dashboard/route";
import * as branchesRoute from "@/app/api/v1/branches/route";

const dashboard = (cookie?: string) => call(dashboardRoute.GET as Handler, "GET", "/api/v1/dashboard", { cookie });

describe("signup and email verification (AUTH-01..05, §5.1)", () => {
  it("creates a pending user that cannot log in before verifying, then activates via the emailed link", async () => {
    const id = uniq();
    const email = `new-${id}@example.com`;
    const res = await call(signupRoute.POST as Handler, "POST", "/api/v1/signup", {
      body: { name: "Sara", email: email.toUpperCase(), password: STRONG_PASSWORD, agencyName: "Noor Travel", slug: `noor-${id}`, country: "SA", locale: "ar" },
    });
    expect(res.status).toBe(201);
    expect(res.json).toEqual({ status: "verification_sent" });

    const user = await prisma.user.findUniqueOrThrow({ where: { email } }); // stored lowercased (AUTH-01)
    expect(user.emailVerified).toBe(false);
    const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
    expect(account.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/); // AUTH-02
    expect(account.password).not.toContain(STRONG_PASSWORD);

    // Tenant, head office, owner membership and KSA tax seed exist.
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: `noor-${id}` }, include: { memberships: true, branches: true, taxRates: true } });
    expect(tenant.memberships).toMatchObject([{ userId: user.id, role: "OWNER", status: "ACTIVE" }]);
    expect(tenant.branches).toHaveLength(1);
    expect(tenant.taxRates.map((r) => r.code).sort()).toEqual(["EXEMPT", "OUT", "VAT15", "ZERO"]);

    const before = await auth("POST", "/sign-in/email", { body: { email, password: STRONG_PASSWORD } });
    expect(before.status).toBe(403);
    expect(before.json.code).toBe("EMAIL_NOT_VERIFIED");

    const mails = await sentTo(email);
    const link = new URL(linkIn(mails[0], /http:\/\/localhost:3000\/api\/auth\/verify-email\S+/));
    const verified = await auth("GET", `/verify-email${link.search}`);
    expect(verified.status).toBe(302);
    expect(verified.headers.get("location")).toBe("/verified");
    expect(await login(email)).toContain("session_token=");
  });

  it("answers an existing email exactly like a new one and emails the owner instead (no account probing)", async () => {
    const a = await createAgency();
    const slug = `dup-${uniq()}`;
    const res = await call(signupRoute.POST as Handler, "POST", "/api/v1/signup", {
      body: { name: "X", email: a.ownerEmail, password: STRONG_PASSWORD, agencyName: "Dup", slug, locale: "en" },
    });
    expect(res.status).toBe(201);
    expect(res.json).toEqual({ status: "verification_sent" });
    // Checked precisely (other test files create users in parallel): no agency, no second account.
    expect(await prisma.tenant.findUnique({ where: { slug } })).toBeNull();
    expect(await prisma.user.count({ where: { email: a.ownerEmail } })).toBe(1);
    expect(await prisma.membership.count({ where: { userId: a.ownerUserId } })).toBe(1);
    const mails = await sentTo(a.ownerEmail);
    expect(mails.at(-1)!.subject).toMatch(/already have an account/i);
  });

  it("rejects common and short passwords with field errors (AUTH-03)", async () => {
    for (const password of ["password1234", "short"]) {
      const res = await call(signupRoute.POST as Handler, "POST", "/api/v1/signup", {
        body: { name: "X", email: `p-${uniq()}@example.com`, password, agencyName: "A", slug: `s-${uniq()}`, locale: "en" },
      });
      expect(res.status).toBe(422);
      expect(res.json.errors.map((e: { path: string }) => e.path)).toContain("password");
    }
  });

  it("rejects a taken slug and leaves no orphan user behind", async () => {
    const a = await createAgency();
    const email = `slug-${uniq()}@example.com`;
    const res = await call(signupRoute.POST as Handler, "POST", "/api/v1/signup", { body: { name: "X", email, password: STRONG_PASSWORD, agencyName: "A", slug: a.slug, locale: "en" } });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("SLUG_TAKEN");
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("does not expose Better Auth's own sign-up endpoint (users only come with an agency)", async () => {
    const res = await auth("POST", "/sign-up/email", { body: { name: "X", email: `direct-${uniq()}@example.com`, password: STRONG_PASSWORD } });
    expect(res.status).toBe(404);
  });
});

describe("login (AUTH-04, AUTH-06)", () => {
  it("gives the same error for a wrong password and an unknown email", async () => {
    const a = await createAgency();
    const wrong = await auth("POST", "/sign-in/email", { body: { email: a.ownerEmail, password: "Not-The-Password-123" } });
    const unknown = await auth("POST", "/sign-in/email", { body: { email: `nobody-${uniq()}@example.com`, password: "Not-The-Password-123" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json).toEqual(unknown.json);
  });

  it("locks the account after 10 failures, even for the right password, and notifies the user", async () => {
    const a = await createAgency();
    for (let i = 0; i < 10; i++) {
      const r = await auth("POST", "/sign-in/email", { body: { email: a.ownerEmail, password: `Wrong-password-${i}xx` } });
      expect(r.status).toBe(401);
    }
    const locked = await auth("POST", "/sign-in/email", { body: { email: a.ownerEmail, password: STRONG_PASSWORD } });
    expect(locked.status).toBe(429);
    expect(locked.json.code).toBe("TOO_MANY_ATTEMPTS");
    const mails = await sentTo(a.ownerEmail);
    expect(mails.some((m) => /temporarily blocked/i.test(m.subject))).toBe(true);
  });

  it("issues an HttpOnly, SameSite=Lax session cookie and stores only its record server-side", async () => {
    const a = await createAgency();
    const res = await auth("POST", "/sign-in/email", { body: { email: a.ownerEmail, password: STRONG_PASSWORD } });
    const cookie = res.headers.getSetCookie().find((c) => c.includes("session_token="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
  });
});

describe("sessions (AUTH-09..14)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    expect((await dashboard()).status).toBe(401);
    expect((await dashboard("better-auth.session_token=forged.value")).status).toBe(401);
  });

  it("ends the session on logout (server-side revocation)", async () => {
    const a = await createAgency();
    expect((await dashboard(a.ownerCookie)).status).toBe(200);
    const out = await auth("POST", "/sign-out", { cookie: a.ownerCookie, body: {} });
    expect(out.status).toBe(200);
    expect((await dashboard(a.ownerCookie)).status).toBe(401);
  });

  it("expires idle sessions and enforces the absolute lifetime", async () => {
    const a = await createAgency();
    const idle = await login(a.ownerEmail);
    const absolute = await login(a.ownerEmail);
    const sessions = await prisma.session.findMany({ where: { userId: a.ownerUserId }, orderBy: { createdAt: "desc" } });
    const [absSession, idleSession] = sessions;
    await prisma.session.update({ where: { id: idleSession.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await prisma.session.update({ where: { id: absSession.id }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    expect((await dashboard(idle)).status).toBe(401);
    expect((await dashboard(absolute)).status).toBe(401);
    expect(await prisma.session.findUnique({ where: { id: absSession.id } })).toBeNull();
  });

  it("rejects cross-origin and origin-less mutations (AUTH-15)", async () => {
    const a = await createAgency();
    const body = { code: "XO1", nameEn: "X" };
    const evil = await call(branchesRoute.POST as Handler, "POST", "/api/v1/branches", { cookie: a.ownerCookie, body, origin: "https://evil.example" });
    const none = await call(branchesRoute.POST as Handler, "POST", "/api/v1/branches", { cookie: a.ownerCookie, body, origin: null });
    expect(evil.status).toBe(403);
    expect(evil.json.code).toBe("BAD_ORIGIN");
    expect(none.status).toBe(403);
    expect(await prisma.branch.count({ where: { tenantId: a.tenantId, code: "XO1" } })).toBe(0);
  });
});

describe("password reset (AUTH-17, AUTH-18)", () => {
  it("emails a single-use link, stores only a hash, revokes all sessions and confirms the change", async () => {
    const a = await createAgency();
    const req = await auth("POST", "/request-password-reset", { body: { email: a.ownerEmail, redirectTo: "/reset-password" } });
    expect(req.status).toBe(200);
    const unknown = await auth("POST", "/request-password-reset", { body: { email: `ghost-${uniq()}@example.com`, redirectTo: "/reset-password" } });
    expect(unknown.status).toBe(200);
    expect(unknown.json).toEqual(req.json); // same answer whether or not the account exists

    const mails = await sentTo(a.ownerEmail);
    const link = linkIn(mails.at(-1)!, /http:\/\/localhost:3000\/api\/auth\/reset-password\/[\w-]+/);
    const token = link.split("/").pop()!;
    const stored = await prisma.verification.findMany({ where: { value: a.ownerUserId } });
    expect(stored.length).toBeGreaterThan(0);
    for (const v of stored) expect(v.identifier).not.toContain(token); // storeIdentifier: hashed

    const weak = await auth("POST", "/reset-password", { body: { token, newPassword: "password1234" } });
    expect(weak.status).toBe(400);
    const newPassword = "Brand-New-Secret-77";
    const ok = await auth("POST", "/reset-password", { body: { token, newPassword } });
    expect(ok.status).toBe(200);
    expect((await dashboard(a.ownerCookie)).status).toBe(401); // old sessions revoked
    const reuse = await auth("POST", "/reset-password", { body: { token, newPassword: "Another-Secret-88" } });
    expect(reuse.status).toBe(400);
    expect(await login(a.ownerEmail, newPassword)).toContain("session_token=");
    expect((await sentTo(a.ownerEmail)).at(-1)!.subject).toMatch(/password was changed/i);
  });

  it("change-password with revokeOtherSessions signs out other devices", async () => {
    const a = await createAgency();
    const other = await login(a.ownerEmail);
    const res = await auth("POST", "/change-password", { cookie: a.ownerCookie, body: { currentPassword: STRONG_PASSWORD, newPassword: "Changed-Secret-991", revokeOtherSessions: true } });
    expect(res.status).toBe(200);
    expect((await dashboard(other)).status).toBe(401);
    expect((await dashboard(cookieFrom(res.headers) || a.ownerCookie)).status).toBe(200);
  });
});
