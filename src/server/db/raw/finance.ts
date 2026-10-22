import type { Prisma } from "@/generated/prisma/client";

type Tx = { $queryRaw<T>(q: TemplateStringsArray, ...v: unknown[]): Prisma.PrismaPromise<T> };

// Row locks for balance-changing operations. Ordered by id so concurrent transactions never deadlock.
export async function lockInvoices(tx: Tx, tenantId: string, ids: string[]): Promise<void> {
  if (ids.length) await tx.$queryRaw`SELECT "id" FROM "invoice" WHERE "tenantId" = ${tenantId}::uuid AND "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`;
}

export async function lockBills(tx: Tx, tenantId: string, ids: string[]): Promise<void> {
  if (ids.length) await tx.$queryRaw`SELECT "id" FROM "supplier_bill" WHERE "tenantId" = ${tenantId}::uuid AND "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`;
}

/** Serializes money movements of one customer (payments, refunds) so credit checks see committed totals. */
export async function lockCustomer(tx: Tx, tenantId: string, customerId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "customer" WHERE "tenantId" = ${tenantId}::uuid AND "id" = ${customerId}::uuid FOR UPDATE`;
}

export async function lockPayment(tx: Tx, tenantId: string, table: "payment" | "supplier_payment", id: string): Promise<void> {
  if (table === "payment") await tx.$queryRaw`SELECT "id" FROM "payment" WHERE "tenantId" = ${tenantId}::uuid AND "id" = ${id}::uuid FOR UPDATE`;
  else await tx.$queryRaw`SELECT "id" FROM "supplier_payment" WHERE "tenantId" = ${tenantId}::uuid AND "id" = ${id}::uuid FOR UPDATE`;
}
