import { createHash, randomBytes } from "node:crypto";
import type { z } from "zod";
import { prisma, tenantDb, type TenantTx } from "@/server/db";
import { getAuth } from "@/server/auth";
import { env } from "@/server/env";
import { audit, diff } from "@/server/audit";
import { authorize, type Ctx, type UserCtx } from "@/server/context";
import { AppError, conflict, forbidden, notFound, unprocessable } from "@/server/errors";
import { enqueueEmail } from "@/server/jobs";
import { emails } from "@/server/emails";
import { assertWithinLimit } from "@/server/plan";
import { hashPassword } from "@/server/password";
import { after, page } from "@/server/pagination";
import { hit } from "@/server/db/raw/rate-limit";
import { canGrantRole, PERMISSIONS, scopeOf } from "@/server/permissions";
import type { acceptInvitationSchema, invitationSchema, listQuery, memberUpdateSchema, profileSchema } from "@/lib/schemas";

const INVITE_TTL_MS = 7 * 86_400_000; // AUTH-20
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Branch-scoped managers act only inside their own branches (§4.6, AUTH-19). */
function assertBranchesInScope(ctx: Ctx, branchIds: string[]) {
  if (authorize(ctx, "user:manage") === "BRANCH" && branchIds.some((b) => !ctx.membership.branchIds.includes(b))) throw forbidden();
}

async function assertActiveBranches(tx: TenantTx, branchIds: string[]) {
  const found = await tx.branch.count({ where: { id: { in: branchIds }, archivedAt: null } });
  if (found !== new Set(branchIds).size) throw unprocessable("INVALID_BRANCH", "One or more branches do not exist or are archived", "branchIds");
}

// ───────── Members ─────────

const memberSelect = {
  id: true, role: true, status: true, jobTitle: true, phone: true, employeeCode: true, primaryBranchId: true, createdAt: true, deactivatedAt: true,
  user: { select: { id: true, name: true, email: true } },
  branches: { select: { branchId: true } },
} as const;

export async function listMembers(ctx: Ctx, q: z.infer<typeof listQuery> & { status?: "ACTIVE" | "DEACTIVATED" }) {
  const scope = authorize(ctx, "user:manage");
  const rows = await ctx.db.membership.findMany({
    where: {
      ...(scope === "BRANCH" ? { branches: { some: { branchId: { in: ctx.membership.branchIds } } } } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { user: { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }] } } : {}),
      ...after(q.cursor, "createdAt", "asc"),
    },
    select: memberSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: q.limit + 1,
  });
  const p = page(rows, q.limit, (r) => r.createdAt);
  return { ...p, data: p.data.map(({ branches, ...m }) => ({ ...m, branchIds: branches.map((b) => b.branchId) })) };
}

export async function getMember(ctx: Ctx, id: string) {
  const scope = authorize(ctx, "user:manage");
  const m = await ctx.db.membership.findFirst({
    where: { id, ...(scope === "BRANCH" ? { branches: { some: { branchId: { in: ctx.membership.branchIds } } } } : {}) },
    select: memberSelect,
  });
  if (!m) throw notFound();
  const { branches, ...rest } = m;
  return { ...rest, branchIds: branches.map((b) => b.branchId) };
}

async function loadManageableMember(ctx: Ctx, tx: TenantTx, id: string) {
  const scope = authorize(ctx, "user:manage");
  const m = await tx.membership.findUnique({ where: { id }, select: memberSelect });
  if (!m) throw notFound();
  const branchIds = m.branches.map((b) => b.branchId);
  // Out-of-scope members are invisible, not forbidden (TEN-06 style).
  if (scope === "BRANCH" && !branchIds.some((b) => ctx.membership.branchIds.includes(b))) throw notFound();
  // AUTH-23: you cannot manage someone holding a role you could not grant, nor yourself.
  if (m.user.id === ctx.user.id || !canGrantRole(ctx.membership.role, m.role)) throw forbidden();
  if (scope === "BRANCH") assertBranchesInScope(ctx, branchIds);
  return { ...m, branchIds };
}

export async function updateMember(ctx: Ctx, id: string, input: z.infer<typeof memberUpdateSchema>) {
  return ctx.db.$transaction(async (tx) => {
    const m = await loadManageableMember(ctx, tx, id);
    if (input.role && !canGrantRole(ctx.membership.role, input.role)) throw forbidden();
    const branchIds = input.branchIds ?? m.branchIds;
    const primaryBranchId = input.primaryBranchId ?? (branchIds.includes(m.primaryBranchId) ? m.primaryBranchId : branchIds[0]);
    if (!branchIds.includes(primaryBranchId)) throw unprocessable("PRIMARY_NOT_ASSIGNED", "The primary branch must be one of the assigned branches", "primaryBranchId");
    if (input.branchIds) {
      assertBranchesInScope(ctx, branchIds);
      await assertActiveBranches(tx, branchIds);
    }
    const leavingOwner = m.role === "OWNER" && ((input.role && input.role !== "OWNER") || input.status === "DEACTIVATED");
    if (leavingOwner && (await tx.membership.count({ where: { role: "OWNER", status: "ACTIVE", id: { not: id } } })) === 0)
      throw unprocessable("LAST_OWNER", "An agency needs at least one active owner");
    if (input.status === "ACTIVE" && m.status === "DEACTIVATED") await assertWithinLimit(tx, ctx.tenant.id, ctx.tenant.planId, "users");

    const data = {
      ...(input.role ? { role: input.role } : {}),
      ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
      ...(input.status ? { status: input.status, deactivatedAt: input.status === "DEACTIVATED" ? new Date() : null } : {}),
      primaryBranchId,
    };
    await tx.membership.update({ where: { id }, data });
    if (input.branchIds) {
      await tx.membershipBranch.deleteMany({ where: { membershipId: id } });
      await tx.membershipBranch.createMany({ data: branchIds.map((branchId) => ({ tenantId: ctx.tenant.id, membershipId: id, branchId })) });
    }
    if (input.status === "DEACTIVATED") {
      // AUTH-14: access ends on the next request anyway; also drop sessions currently pointed at this agency.
      await prisma.session.deleteMany({ where: { userId: m.user.id, activeTenantId: ctx.tenant.id } });
    }
    const changes = diff({ ...m, branchIds: [...m.branchIds].sort() }, { ...data, ...(input.branchIds ? { branchIds: [...branchIds].sort() } : {}) });
    if (changes) {
      const action = input.status === "DEACTIVATED" ? "membership.deactivated" : input.status === "ACTIVE" && m.status === "DEACTIVATED" ? "membership.reactivated" : "membership.updated";
      await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action, entityType: "Membership", entityId: id, changes });
    }
    return { id };
  });
}

/** AUTH-13: owners/admins can sign a member out everywhere. */
export async function revokeMemberSessions(ctx: Ctx, id: string) {
  if (authorize(ctx, "user:manage") !== "ALL") throw forbidden();
  return ctx.db.$transaction(async (tx) => {
    const m = await loadManageableMember(ctx, tx, id);
    const { count } = await prisma.session.deleteMany({ where: { userId: m.user.id } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "membership.sessions_revoked", entityType: "Membership", entityId: id, metadata: { count } });
    return { revoked: count };
  });
}

// ───────── Invitations (§4.4) ─────────

export async function listInvitations(ctx: Ctx, q: z.infer<typeof listQuery>) {
  const scope = authorize(ctx, "user:invite");
  const rows = await ctx.db.invitation.findMany({
    where: {
      acceptedAt: null,
      revokedAt: null,
      ...(scope === "BRANCH" ? { branchIds: { hasSome: ctx.membership.branchIds } } : {}),
      ...(q.q ? { email: { contains: q.q, mode: "insensitive" } } : {}),
      ...after(q.cursor, "createdAt", "desc"),
    },
    select: { id: true, email: true, role: true, branchIds: true, expiresAt: true, createdAt: true, invitedBy: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  const p = page(rows, q.limit, (r) => r.createdAt);
  return { ...p, data: p.data.map((r) => ({ ...r, expired: r.expiresAt < new Date() })) };
}

async function sendInvitationEmail(ctx: Ctx, email: string, token: string) {
  const agency = (ctx.user.locale === "ar" && ctx.tenant.legalNameAr) || ctx.tenant.legalNameEn;
  await enqueueEmail(prisma, emails.invitation(ctx.user.locale, email, agency, ctx.user.name, `${env().APP_URL}/invite/${token}`), ctx.tenant.id);
}

export async function createInvitation(ctx: Ctx, input: z.infer<typeof invitationSchema>) {
  authorize(ctx, "user:invite");
  if (!canGrantRole(ctx.membership.role, input.role)) throw forbidden(); // AUTH-19, AUTH-23
  assertBranchesInScope(ctx, input.branchIds);
  if ((await hit(`invite:tenant:${ctx.tenant.id}`, 86_400)) > 50) throw new AppError(429, "RATE_LIMITED", "Too many invitations today"); // SEC-14

  const token = randomBytes(32).toString("base64url");
  const invitation = await ctx.db.$transaction(async (tx) => {
    await assertActiveBranches(tx, input.branchIds);
    const member = await tx.membership.findFirst({ where: { user: { email: input.email } } });
    if (member?.status === "ACTIVE") throw conflict("ALREADY_MEMBER", "This person is already a member");
    const pending = await tx.invitation.findFirst({ where: { email: input.email, acceptedAt: null, revokedAt: null } });
    if (pending) throw conflict("INVITATION_PENDING", "An invitation is already pending for this email");
    await assertWithinLimit(tx, ctx.tenant.id, ctx.tenant.planId, "users"); // AUTH-22
    const inv = await tx.invitation.create({
      data: { tenantId: ctx.tenant.id, email: input.email, role: input.role, branchIds: input.branchIds, tokenHash: hashToken(token), invitedById: ctx.user.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
    });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "invitation.created", entityType: "Invitation", entityId: inv.id, metadata: { email: input.email, role: input.role, branchIds: input.branchIds } });
    return inv;
  });
  await sendInvitationEmail(ctx, input.email, token);
  return { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt };
}

async function loadManageableInvitation(ctx: Ctx, tx: TenantTx, id: string) {
  const scope = authorize(ctx, "user:invite");
  const inv = await tx.invitation.findUnique({ where: { id } });
  if (!inv || inv.acceptedAt || inv.revokedAt) throw notFound();
  if (scope === "BRANCH" && !inv.branchIds.some((b) => ctx.membership.branchIds.includes(b))) throw notFound();
  if (!canGrantRole(ctx.membership.role, inv.role)) throw forbidden();
  return inv;
}

export async function revokeInvitation(ctx: Ctx, id: string) {
  await ctx.db.$transaction(async (tx) => {
    await loadManageableInvitation(ctx, tx, id);
    await tx.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "invitation.revoked", entityType: "Invitation", entityId: id });
  });
}

/** AUTH-20: resending issues a new token (the old link stops working) and a fresh 7-day expiry. */
export async function resendInvitation(ctx: Ctx, id: string) {
  const token = randomBytes(32).toString("base64url");
  const inv = await ctx.db.$transaction(async (tx) => {
    await loadManageableInvitation(ctx, tx, id);
    const updated = await tx.invitation.update({ where: { id }, data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "invitation.resent", entityType: "Invitation", entityId: id });
    return updated;
  });
  await sendInvitationEmail(ctx, inv.email, token);
  return { id, expiresAt: inv.expiresAt };
}

async function findPendingInvitation(token: string) {
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { tenant: true } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) throw new AppError(404, "INVITATION_INVALID", "This invitation is invalid or has expired");
  return inv;
}

/** Public lookup for the accept page: what agency, which email, and whether that email already has an account. */
export async function lookupInvitation(token: string) {
  const inv = await findPendingInvitation(token);
  const hasAccount = !!(await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } }));
  return { email: inv.email, role: inv.role, agency: { nameEn: inv.tenant.legalNameEn, nameAr: inv.tenant.legalNameAr }, hasAccount };
}

/**
 * AUTH-21. New users set name + password here (their email is proven by the token). Existing users must be
 * logged in as the invited email. Returns Set-Cookie headers when a new user is signed in.
 */
export async function acceptInvitation(input: z.infer<typeof acceptInvitationSchema>, current: UserCtx | null) {
  const inv = await findPendingInvitation(input.token);
  const existing = await prisma.user.findUnique({ where: { email: inv.email } });
  if (existing && !current) throw new AppError(401, "LOGIN_REQUIRED", "Log in with the invited email to accept");
  if (current && current.user.email !== inv.email) throw new AppError(403, "EMAIL_MISMATCH", "This invitation is for a different email address");
  if (!existing && (!input.name || !input.password)) throw unprocessable("ACCOUNT_DETAILS_REQUIRED", "Name and password are required", input.name ? "password" : "name");

  const passwordHash = existing ? null : await hashPassword(input.password!);
  const tenantId = inv.tenantId;
  const userId = await tenantDb(tenantId).$transaction(async (tx) => {
    // Re-check under the transaction so two accepts of one invitation cannot both succeed.
    const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date() } });
    if (claimed.count !== 1) throw new AppError(404, "INVITATION_INVALID", "This invitation is invalid or has expired");

    let uid = existing?.id;
    if (!uid) {
      const user = await tx.user.create({ data: { name: input.name!, email: inv.email, emailVerified: true, locale: input.locale ?? inv.tenant.defaultLocale } });
      await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash } });
      uid = user.id;
    }
    const activeBranches = await tx.branch.findMany({ where: { archivedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
    const valid = inv.branchIds.filter((b) => activeBranches.some((a) => a.id === b));
    const branchIds = valid.length ? valid : [activeBranches[0].id];
    const prior = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: uid } } });
    let membershipId = prior?.id;
    if (prior?.status === "ACTIVE") {
      // Already a member; the invitation is simply consumed.
    } else if (prior) {
      await tx.membership.update({ where: { id: prior.id }, data: { status: "ACTIVE", deactivatedAt: null, role: inv.role, primaryBranchId: branchIds[0] } });
      await tx.membershipBranch.deleteMany({ where: { membershipId: prior.id } });
      await tx.membershipBranch.createMany({ data: branchIds.map((branchId) => ({ tenantId, membershipId: prior.id, branchId })) });
    } else {
      const m = await tx.membership.create({
        data: { tenantId, userId: uid, role: inv.role, primaryBranchId: branchIds[0], branches: { create: branchIds.map((branchId) => ({ branchId })) } },
      });
      membershipId = m.id;
    }
    const actor = { type: "USER" as const, id: uid };
    await audit(tx, { tenantId, actor, action: "invitation.accepted", entityType: "Invitation", entityId: inv.id });
    await audit(tx, { tenantId, actor, action: prior ? "membership.reactivated" : "membership.created", entityType: "Membership", entityId: membershipId, metadata: { role: inv.role, branchIds } });
    if (current) await tx.session.update({ where: { id: current.session.id }, data: { activeTenantId: tenantId } });
    return uid;
  });

  if (existing) return { userId, headers: null };
  const { headers } = await getAuth().api.signInEmail({ body: { email: inv.email, password: input.password! }, returnHeaders: true });
  return { userId, headers };
}

// ───────── Current user ─────────

export async function me(u: UserCtx, ctx: Ctx | null) {
  const memberships = await prisma.membership.findMany({
    where: { userId: u.user.id, status: "ACTIVE" },
    select: { tenantId: true, role: true, tenant: { select: { legalNameEn: true, legalNameAr: true, slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  return {
    user: u.user,
    activeTenantId: ctx?.tenant.id ?? null,
    role: ctx?.membership.role ?? null,
    branchIds: ctx?.membership.branchIds ?? [],
    permissions: ctx ? PERMISSIONS.filter((p) => scopeOf(ctx.membership.role, p)).map((p) => ({ permission: p, scope: scopeOf(ctx.membership.role, p) })) : [],
    memberships: memberships.map((m) => ({ tenantId: m.tenantId, role: m.role, nameEn: m.tenant.legalNameEn, nameAr: m.tenant.legalNameAr, slug: m.tenant.slug })),
  };
}

export async function updateProfile(u: UserCtx, input: z.infer<typeof profileSchema>) {
  await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: u.user.id } });
    await tx.user.update({ where: { id: u.user.id }, data: input });
    const changes = diff(before, input);
    if (changes) await audit(tx, { tenantId: null, actor: u.actor, action: "user.profile_updated", entityType: "User", entityId: u.user.id, changes });
  });
  return { ...u.user, ...input };
}

/** Switch the session's active agency. Only to agencies where the user holds an active membership. */
export async function switchTenant(u: UserCtx, tenantId: string) {
  const m = await prisma.membership.findFirst({ where: { userId: u.user.id, tenantId, status: "ACTIVE" } });
  if (!m) throw notFound();
  await prisma.$transaction(async (tx) => {
    await tx.session.update({ where: { id: u.session.id }, data: { activeTenantId: tenantId } });
    await audit(tx, { tenantId, actor: u.actor, action: "session.tenant_switched", entityType: "Session", entityId: u.session.id });
  });
  return { activeTenantId: tenantId };
}

