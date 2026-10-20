import { prisma } from "@/server/db";

/** Fixed-window counter (SEC-14). Returns the count after this hit. Ceiling: one DB write per call; move to Redis behind this function if hot. */
export async function hit(key: string, windowSec: number): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limit_bucket" ("key", "windowStart", "count")
    VALUES (${key}, to_timestamp(floor(extract(epoch FROM now()) / ${windowSec}) * ${windowSec}), 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "rate_limit_bucket"."count" + 1
    RETURNING "count"`;
  return rows[0].count;
}

export async function peek(key: string, windowSec: number): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT "count" FROM "rate_limit_bucket"
    WHERE "key" = ${key} AND "windowStart" = to_timestamp(floor(extract(epoch FROM now()) / ${windowSec}) * ${windowSec})`;
  return rows[0]?.count ?? 0;
}

export async function clear(key: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "rate_limit_bucket" WHERE "key" = ${key}`;
}
