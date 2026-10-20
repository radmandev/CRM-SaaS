import { Prisma } from "@/generated/prisma/client";

type Tx = { $queryRaw<T>(q: TemplateStringsArray | Prisma.Sql, ...v: unknown[]): Prisma.PrismaPromise<T> };

/**
 * NUM-02: allocate the next number of a per-tenant series inside the caller's transaction.
 * The upsert takes a row lock, so concurrent callers serialize and numbers are gapless per committed transaction.
 */
export async function nextSequenceValue(tx: Tx, tenantId: string, series: string, year: number): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "number_sequence" ("tenantId", "series", "year", "nextValue")
    VALUES (${tenantId}::uuid, ${series}, ${year}, 2)
    ON CONFLICT ("tenantId", "series", "year") DO UPDATE SET "nextValue" = "number_sequence"."nextValue" + 1
    RETURNING "nextValue" - 1 AS value`;
  return Number(rows[0].value);
}
