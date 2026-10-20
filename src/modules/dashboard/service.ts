import { can, type Ctx } from "@/server/context";
import { entitlements, usage } from "@/server/plan";

/** Phase 1 dashboard (§15.1): setup checklist, team and plan usage, all from persisted data. */
export async function getDashboard(ctx: Ctx) {
  const t = await ctx.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, include: { plan: true } });
  const [used, limits, logo, activeTaxRates, branches, members, pendingInvites, recent] = await Promise.all([
    usage(ctx.db),
    entitlements(t.planId),
    ctx.db.document.count({ where: { category: "LOGO" } }),
    ctx.db.taxRate.count({ where: { active: true } }),
    ctx.db.branch.count({ where: { archivedAt: null } }),
    ctx.db.membership.count({ where: { status: "ACTIVE" } }),
    ctx.db.invitation.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    can(ctx, "audit:read")
      ? ctx.db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { id: true, action: true, entityType: true, actorId: true, createdAt: true } })
      : Promise.resolve([]),
  ]);
  const actors = await ctx.db.membership.findMany({
    where: { userId: { in: [...new Set(recent.map((r) => r.actorId).filter((x): x is string => !!x))] } },
    select: { userId: true, user: { select: { name: true } } },
  });
  const actorName = new Map(actors.map((a) => [a.userId, a.user.name]));

  const checklist = [
    { key: "profile", href: "/settings/agency", done: !!(t.legalNameEn && t.addressCity && t.phone && t.email) },
    { key: "legal", href: "/settings/agency", done: !!t.crNumber && (!t.vatRegistered || !!t.vatNumber) },
    { key: "branding", href: "/settings/agency", done: logo > 0 },
    { key: "tax", href: "/settings/tax-rates", done: activeTaxRates > 0 && (t.vatRegistered ? !!t.vatNumber : true) },
    { key: "branches", href: "/settings/branches", done: branches > 1 || !!t.addressCity },
    { key: "team", href: "/settings/users", done: members > 1 || pendingInvites > 0 },
  ];
  return {
    tenant: { name: t.legalNameEn, nameAr: t.legalNameAr, status: t.status, trialEndsAt: t.trialEndsAt, plan: { code: t.plan.code, nameEn: t.plan.nameEn, nameAr: t.plan.nameAr } },
    checklist,
    team: { members, pendingInvites, branches },
    usage: {
      users: { used: used.users, limit: limits.maxUsers },
      branches: { used: used.branches, limit: limits.maxBranches },
      storage: { usedBytes: used.storageBytes, limitBytes: limits.storageGb * 1024 ** 3 },
    },
    recentActivity: recent.map((r) => ({ ...r, actorName: (r.actorId && actorName.get(r.actorId)) || null })),
  };
}
