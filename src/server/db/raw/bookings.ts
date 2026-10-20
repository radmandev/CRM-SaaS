import type { Prisma } from "@/generated/prisma/client";

type Tx = { $queryRaw<T>(q: TemplateStringsArray, ...v: unknown[]): Prisma.PrismaPromise<T> };

/** Serializes writes to one booking (items, passengers, totals) inside the caller's transaction. */
export async function lockBooking(tx: Tx, tenantId: string, bookingId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "booking" WHERE "tenantId" = ${tenantId}::uuid AND "id" = ${bookingId}::uuid FOR UPDATE`;
  return rows.length === 1;
}
