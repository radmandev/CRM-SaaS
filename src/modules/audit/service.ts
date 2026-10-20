import type { z } from "zod";
import { authorize, type Ctx } from "@/server/context";
import { after, page } from "@/server/pagination";
import type { listQuery } from "@/lib/schemas";

/** Audit log viewer (AUD-01). Branch managers see actions by members of their branches. */
export async function listAuditLogs(ctx: Ctx, q: z.infer<typeof listQuery> & { entityType?: string; entityId?: string }) {
  const scope = authorize(ctx, "audit:read");
  let actorIds: string[] | undefined;
  if (scope === "BRANCH") {
    const members = await ctx.db.membership.findMany({ where: { branches: { some: { branchId: { in: ctx.membership.branchIds } } } }, select: { userId: true } });
    actorIds = members.map((m) => m.userId);
  }
  const rows = await ctx.db.auditLog.findMany({
    where: {
      ...(actorIds ? { actorId: { in: actorIds } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.q ? { action: { contains: q.q, mode: "insensitive" } } : {}),
      ...after(q.cursor, "createdAt", "desc"),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  const names = await ctx.db.membership.findMany({
    where: { userId: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))] } },
    select: { userId: true, user: { select: { name: true } } },
  });
  const byId = new Map(names.map((n) => [n.userId, n.user.name]));
  const p = page(rows, q.limit, (r) => r.createdAt);
  return { ...p, data: p.data.map((r) => ({ ...r, actorName: (r.actorId && byId.get(r.actorId)) || null })) };
}
