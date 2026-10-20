import type { Prisma } from "@/generated/prisma/client";

type Tx = { $queryRaw<T>(q: TemplateStringsArray, ...v: unknown[]): Prisma.PrismaPromise<T> };

/** Serializes limit checks per tenant (SUB-01): count-then-insert runs under this row lock. */
export async function lockTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "tenant" WHERE "id" = ${tenantId}::uuid FOR UPDATE`;
}
