import type { Prisma } from "@/generated/prisma/client";
import type { ActorType } from "@/generated/prisma/enums";

type AuditWriter = { auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): PromiseLike<unknown> } };

export type Actor = { type: ActorType; id: string | null };

export type AuditEntry = {
  tenantId: string | null;
  actor: Actor;
  action: string;
  entityType: string;
  entityId?: string | null;
  parentEntityType?: string;
  parentEntityId?: string;
  changes?: Record<string, [unknown, unknown]> | null;
  metadata?: Record<string, unknown>;
};

const REDACTED = new Set(["password", "token", "tokenHash"]);

/** AUD-02: called by services inside the same transaction as the change. */
export async function audit(tx: AuditWriter, e: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: e.tenantId,
      actorType: e.actor.type,
      actorId: e.actor.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      parentEntityType: e.parentEntityType,
      parentEntityId: e.parentEntityId,
      changes: (e.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: e.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v != null && typeof v === "object" && "toFixed" in v ? String(v) : v);

/** Field-level diff `{ field: [old, new] }` of the keys present in `after`. Sensitive keys are redacted. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, [unknown, unknown]> | null {
  const out: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(after)) {
    const a = norm(before[key]);
    const b = norm(after[key]);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out[key] = REDACTED.has(key) ? ["[redacted]", "[redacted]"] : [a ?? null, b ?? null];
  }
  return Object.keys(out).length ? out : null;
}
