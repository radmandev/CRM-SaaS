import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { runJob } from "@/server/jobs";
import { fakeOutbox, type Email } from "@/server/email";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as signupRoute from "@/app/api/v1/signup/route";
import * as invitationsRoute from "@/app/api/v1/invitations/route";
import * as acceptRoute from "@/app/api/v1/invitations/accept/route";
import type { Role } from "@/generated/prisma/enums";

export const APP = "http://localhost:3000";
type Handler = (req: Request, rc: { params: Promise<Record<string, string>> }) => Promise<Response>;

export type CallOptions = { body?: unknown; cookie?: string; params?: Record<string, string>; origin?: string | null; ip?: string; headers?: Record<string, string> };

/** Invoke a route handler the way Next.js would. Mutations carry our Origin unless told otherwise (AUTH-15). */
export async function call(handler: Handler, method: string, path: string, opts: CallOptions = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": opts.ip ?? randomIp(), ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin !== null && method !== "GET") headers.origin = opts.origin ?? APP;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`${APP}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, json, headers: res.headers, text };
}

export const auth = (method: "GET" | "POST", path: string, opts: CallOptions = {}) =>
  call(((req: Request) => (method === "GET" ? authRoute.GET(req) : authRoute.POST(req))) as Handler, method, `/api/auth${path}`, opts);

export const randomIp = () => `10.${rnd()}.${rnd()}.${rnd()}`;
const rnd = () => Math.floor(Math.random() * 250) + 1;
export const uniq = () => randomBytes(5).toString("hex");
export const STRONG_PASSWORD = "Correct-Horse-Battery-42";

/** Cookie header ("a=1; b=2") from a response's Set-Cookie headers. */
export function cookieFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ");
}

/** Run queued email jobs and return what the fake provider "sent" to this address. */
export async function sentTo(email: string): Promise<Email[]> {
  const jobs = await prisma.job.findMany({ where: { type: "email.send", status: "QUEUED" } });
  for (const job of jobs.filter((j) => (j.payload as { to?: string }).to === email)) {
    const claimed = await prisma.job.updateMany({ where: { id: job.id, status: "QUEUED" }, data: { status: "RUNNING", attempts: { increment: 1 } } });
    if (claimed.count) await runJob({ ...job, attempts: job.attempts + 1 });
  }
  return fakeOutbox.filter((e) => e.to === email);
}

export const linkIn = (email: Email, pattern: RegExp) => {
  const m = email.text.match(pattern);
  if (!m) throw new Error(`No link matching ${pattern} in: ${email.text}`);
  return m[0];
};

export async function login(email: string, password = STRONG_PASSWORD) {
  const res = await auth("POST", "/sign-in/email", { body: { email, password } });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${res.text}`);
  return cookieFrom(res.headers);
}

export type TestAgency = { tenantId: string; ownerCookie: string; ownerEmail: string; ownerUserId: string; branchId: string; slug: string };

/** Sign up an agency through the public API, verify the email via the real link, and log in. */
export async function createAgency(opts: { plan?: string } = {}): Promise<TestAgency> {
  const id = uniq();
  const ownerEmail = `owner-${id}@example.com`;
  const slug = `agency-${id}`;
  const res = await call(signupRoute.POST as Handler, "POST", "/api/v1/signup", {
    body: { name: `Owner ${id}`, email: ownerEmail, password: STRONG_PASSWORD, agencyName: `Agency ${id}`, slug, country: "SA", locale: "en" },
  });
  if (res.status !== 201) throw new Error(`signup failed ${res.status} ${res.text}`);
  const [mail] = await sentTo(ownerEmail);
  const link = new URL(linkIn(mail, /http:\/\/localhost:3000\/api\/auth\/verify-email\S+/));
  const verified = await auth("GET", `/verify-email${link.search}`);
  if (verified.status !== 302) throw new Error(`verify failed ${verified.status} ${verified.text}`);
  const ownerCookie = await login(ownerEmail);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug }, include: { branches: true, memberships: true } });
  if (opts.plan) {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: opts.plan } });
    await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id } });
  }
  return { tenantId: tenant.id, ownerCookie, ownerEmail, ownerUserId: tenant.memberships[0].userId, branchId: tenant.branches[0].id, slug };
}

/** Invite through the API as `inviterCookie`, accept through the API as a new user, return their session. */
export async function addMember(inviterCookie: string, role: Role, branchIds: string[]) {
  const email = `${role.toLowerCase()}-${uniq()}@example.com`;
  const inv = await call(invitationsRoute.POST as Handler, "POST", "/api/v1/invitations", { cookie: inviterCookie, body: { email, role, branchIds } });
  if (inv.status !== 201) throw new Error(`invite failed ${inv.status} ${inv.text}`);
  const [mail] = await sentTo(email);
  const token = linkIn(mail, /\/invite\/[\w-]+/).split("/").pop()!;
  const acc = await call(acceptRoute.POST as Handler, "POST", "/api/v1/invitations/accept", { body: { token, name: `Member ${role}`, password: STRONG_PASSWORD } });
  if (acc.status !== 200) throw new Error(`accept failed ${acc.status} ${acc.text}`);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const membership = await prisma.membership.findFirstOrThrow({ where: { userId: user.id } });
  return { email, cookie: cookieFrom(acc.headers), userId: user.id, membershipId: membership.id };
}

export { prisma, randomUUID };
export type { Handler };
