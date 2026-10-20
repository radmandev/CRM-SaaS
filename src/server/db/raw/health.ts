import { prisma } from "@/server/db";

/** Readiness (§22.8): database reachable and no failed or unfinished migrations. */
export async function databaseReady(): Promise<{ database: boolean; migrations: boolean }> {
  try {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL`;
    return { database: true, migrations: rows[0].n === 0 };
  } catch {
    return { database: false, migrations: false };
  }
}
