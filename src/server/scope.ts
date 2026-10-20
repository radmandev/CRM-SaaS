import { authorize, type Ctx } from "./context";
import { forbidden } from "./errors";
import type { Permission } from "./permissions";

// §4.6 data scope for records that carry branchId and ownerId (customers, bookings).
type Scoped = { branchId: string; ownerId: string | null };

/** Prisma `where` fragment limiting a list to what the user may see under `permission`. */
export function scopeWhere(ctx: Ctx, permission: Permission): { branchId?: { in: string[] }; ownerId?: string } {
  const scope = authorize(ctx, permission);
  if (scope === "ALL") return {};
  if (scope === "BRANCH") return { branchId: { in: ctx.membership.branchIds } };
  return { ownerId: ctx.membership.id };
}

export function inScope(ctx: Ctx, permission: Permission, record: Scoped): boolean {
  const scope = authorize(ctx, permission);
  if (scope === "ALL") return true;
  if (scope === "BRANCH") return ctx.membership.branchIds.includes(record.branchId);
  return record.ownerId === ctx.membership.id;
}

/** Write check on a record the caller can already see: out of write scope is 403 (it is visible, so 404 would lie). */
export function assertWritable(ctx: Ctx, permission: Permission, record: Scoped) {
  if (!inScope(ctx, permission, record)) throw forbidden();
}

/** Branch assignment rule for new records: must be one of the user's branches unless they hold ALL scope. */
export function assertBranchAllowed(ctx: Ctx, permission: Permission, branchId: string) {
  if (authorize(ctx, permission) !== "ALL" && !ctx.membership.branchIds.includes(branchId)) throw forbidden();
}
