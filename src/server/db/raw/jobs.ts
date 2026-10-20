import { prisma } from "@/server/db";
import type { Job } from "@/generated/prisma/client";

/** JOB-02: claim due jobs; SKIP LOCKED makes concurrent workers safe. */
export function claimJobs(workerId: string, limit: number): Promise<Job[]> {
  return prisma.$queryRaw<Job[]>`
    UPDATE "job" SET "status" = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId},
      "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "job" WHERE "status" = 'QUEUED' AND "runAt" <= now()
      ORDER BY "runAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING *`;
}

/** JOB-06: return jobs whose worker died to the queue. */
export function recoverStuckJobs(olderThanSec: number): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "job" SET "status" = 'QUEUED', "lockedAt" = NULL, "lockedBy" = NULL, "updatedAt" = now()
    WHERE "status" = 'RUNNING' AND "lockedAt" < now() - make_interval(secs => ${olderThanSec})`;
}
