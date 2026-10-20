import type { Role } from "@/generated/prisma/enums";
import { prisma, tenantDb, type TenantDb } from "./db";
import { getAuth } from "./auth";
import { env } from "./env";
import { forbidden, unauthenticated } from "./errors";
import { scopeOf, type Permission, type Scope } from "./permissions";
import type { Actor } from "./audit";
import { isLocale, type Locale } from "@/lib/i18n";

export type UserCtx = {
  user: { id: string; name: string; email: string; locale: Locale };
  session: { id: string; createdAt: Date; activeTenantId: string | null };
  actor: Actor;
};

export type Ctx = UserCtx & {
  tenant: { id: string; slug: string; legalNameEn: string; legalNameAr: string | null; timezone: string; defaultLocale: string; status: string; planId: string };
  membership: { id: string; role: Role; primaryBranchId: string; branchIds: string[] };
  db: TenantDb;
};

/** Authenticated user from the session cookie, or null. Enforces the absolute session lifetime (AUTH-10). */
export async function resolveUser(headers: Headers): Promise<UserCtx | null> {
  const result = await getAuth().api.getSession({ headers });
  if (!result) return null;
  const { session, user } = result;
  const maxAgeMs = env().SESSION_ABSOLUTE_DAYS * 86_400_000;
  if (Date.now() - new Date(session.createdAt).getTime() > maxAgeMs) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  const locale = (user as { locale?: string }).locale;
  return {
    user: { id: user.id, name: user.name, email: user.email, locale: isLocale(locale) ? locale : "ar" },
    session: { id: session.id, createdAt: new Date(session.createdAt), activeTenantId: (session as { activeTenantId?: string | null }).activeTenantId ?? null },
    actor: { type: "USER", id: user.id },
  };
}

/**
 * Tenant context (TEN-02): the tenant comes only from the session's active membership, re-checked on every
 * request so a deactivated membership loses access immediately (AUTH-14). Null when the user has no active membership.
 */
export async function resolveTenant(u: UserCtx): Promise<Ctx | null> {
  const memberships = await prisma.membership.findMany({
    where: { userId: u.user.id, status: "ACTIVE", tenant: { status: { not: "CANCELLED" } } },
    include: { tenant: true, branches: { select: { branchId: true } } },
    orderBy: { createdAt: "asc" },
  });
  const m = memberships.find((x) => x.tenantId === u.session.activeTenantId) ?? memberships[0];
  if (!m) return null;
  if (m.tenantId !== u.session.activeTenantId) {
    await prisma.session.update({ where: { id: u.session.id }, data: { activeTenantId: m.tenantId } });
  }
  const t = m.tenant;
  return {
    ...u,
    session: { ...u.session, activeTenantId: m.tenantId },
    tenant: { id: t.id, slug: t.slug, legalNameEn: t.legalNameEn, legalNameAr: t.legalNameAr, timezone: t.timezone, defaultLocale: t.defaultLocale, status: t.status, planId: t.planId },
    membership: { id: m.id, role: m.role, primaryBranchId: m.primaryBranchId, branchIds: m.branches.map((b) => b.branchId) },
    db: tenantDb(m.tenantId),
  };
}

export async function requireUser(headers: Headers): Promise<UserCtx> {
  const u = await resolveUser(headers);
  if (!u) throw unauthenticated();
  return u;
}

export async function requireTenant(headers: Headers): Promise<Ctx> {
  const ctx = await resolveTenant(await requireUser(headers));
  if (!ctx) throw forbidden();
  return ctx;
}

/** AUTHZ-02: server-side permission check; returns the scope the user holds. */
export function authorize(ctx: Ctx, permission: Permission): Scope {
  const scope = scopeOf(ctx.membership.role, permission);
  if (!scope) throw forbidden();
  return scope;
}

export const can = (ctx: Ctx, permission: Permission) => scopeOf(ctx.membership.role, permission) !== null;
