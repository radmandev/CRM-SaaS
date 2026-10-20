import { z } from "zod";
import { prisma, type TenantTx } from "./db";
import { AppError } from "./errors";
import { lockTenant } from "./db/raw/tenant";

// §19.1. Placeholder values until D-07 (plan names/prices) is decided.
export const entitlementsSchema = z.object({
  maxUsers: z.number().int().positive(),
  maxBranches: z.number().int().positive(),
  storageGb: z.number().positive(),
  maxBookingsPerMonth: z.number().int().positive().nullable(),
  aiCreditsPerMonth: z.number().int().min(0),
  features: z.record(z.string(), z.boolean()),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;

export async function entitlements(planId: string): Promise<Entitlements> {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
  return entitlementsSchema.parse(plan.entitlements);
}

export async function usage(tx: TenantTx) {
  const [members, invites, branches, storage] = await Promise.all([
    tx.membership.count({ where: { status: "ACTIVE" } }),
    tx.invitation.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    tx.branch.count({ where: { archivedAt: null } }),
    tx.document.aggregate({ _sum: { size: true } }),
  ]);
  return { users: members + invites, branches, storageBytes: storage._sum.size ?? 0 }; // AUTH-22: pending invites count
}

/** SUB-01/02: call inside the transaction that creates the counted record. */
export async function assertWithinLimit(tx: TenantTx, tenantId: string, planId: string, kind: "users" | "branches") {
  await lockTenant(tx, tenantId);
  const [limits, used] = await Promise.all([entitlements(planId), usage(tx)]);
  const max = kind === "users" ? limits.maxUsers : limits.maxBranches;
  if (used[kind] >= max) throw new AppError(402, "PLAN_LIMIT_REACHED", `Plan limit reached: ${kind}`, [{ path: kind, code: "PLAN_LIMIT_REACHED", message: String(max) }]);
}
