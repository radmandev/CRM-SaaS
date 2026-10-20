import { can, type Ctx } from "@/server/context";
import { scopeWhere } from "@/server/scope";
import { expiresWithin } from "@/lib/travel";
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
    operations: can(ctx, "booking:read") ? await operations(ctx, t.timezone) : null,
  };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** §15.1 Phase 2 tiles. Each list links to the filtered booking list (DSH-01). */
async function operations(ctx: Ctx, timeZone: string) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const todayDate = new Date(`${today}T00:00:00Z`);
  const scope = scopeWhere(ctx, "booking:read");
  const live = { status: { in: ["DRAFT", "ON_HOLD", "CONFIRMED", "ISSUED"] as ("DRAFT" | "ON_HOLD" | "CONFIRMED" | "ISSUED")[] } };
  const pick = { id: true, reference: true, status: true, customer: { select: { displayName: true } } } as const;
  const in60 = new Date(todayDate.getTime() + 60 * 86_400_000);
  const [departures, returns, held, createdThisWeek, upcoming] = await Promise.all([
    ctx.db.booking.findMany({ where: { ...scope, ...live, travelStartDate: todayDate }, select: pick, take: 10 }),
    ctx.db.booking.findMany({ where: { ...scope, ...live, travelEndDate: todayDate }, select: pick, take: 10 }),
    ctx.db.bookingItem.findMany({
      where: { status: "HELD", optionDeadline: { lte: new Date(Date.now() + 48 * 3_600_000) }, booking: scope },
      select: { id: true, description: true, optionDeadline: true, booking: { select: { id: true, reference: true } } },
      orderBy: { optionDeadline: "asc" },
      take: 10,
    }),
    ctx.db.booking.count({ where: { ...scope, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
    ctx.db.booking.findMany({
      where: { ...scope, ...live, travelStartDate: { gte: todayDate, lte: in60 } },
      select: { id: true, reference: true, travelEndDate: true, travelStartDate: true, items: { where: { serviceType: "FLIGHT", status: { notIn: ["CANCELLED", "FAILED"] } }, select: { id: true } }, passengers: { select: { id: true, firstName: true, lastName: true, docExpiry: true, docLast4: true } } },
      take: 200,
    }),
  ]);
  // CRM-10: passport expiring within 6 months of return, or missing on a booking with flights.
  const documentWarnings = upcoming.flatMap((b) =>
    b.passengers
      .filter((p) => (p.docExpiry ? expiresWithin(isoDay(p.docExpiry), isoDay(b.travelEndDate ?? b.travelStartDate!)) : b.items.length > 0 && !p.docLast4))
      .map((p) => ({ bookingId: b.id, reference: b.reference, passenger: `${p.firstName} ${p.lastName}`, docExpiry: p.docExpiry ? isoDay(p.docExpiry) : null })),
  );
  return { today, departures, returns, held, createdThisWeek, documentWarnings: documentWarnings.slice(0, 20) };
}
