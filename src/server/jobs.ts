import { prisma } from "@/server/db";
import { claimJobs, recoverStuckJobs } from "@/server/db/raw/jobs";
import type { Prisma, Job } from "@/generated/prisma/client";
import { logger } from "./logger";
import { deliver, type Email } from "./email";

type JobWriter = { job: { createMany(args: { data: Prisma.JobCreateManyInput[]; skipDuplicates?: boolean }): PromiseLike<unknown> } };

export type JobOptions = { tenantId?: string | null; runAt?: Date; dedupeKey?: string; maxAttempts?: number };

/** JOB-01: pass the transaction client so the job commits (or not) with the business change. */
export async function enqueue(db: JobWriter, type: JobType, payload: Record<string, unknown>, opts: JobOptions = {}) {
  await db.job.createMany({
    data: [{ type, payload: payload as Prisma.InputJsonValue, tenantId: opts.tenantId ?? null, runAt: opts.runAt, dedupeKey: opts.dedupeKey, maxAttempts: opts.maxAttempts }],
    skipDuplicates: true, // JOB-04: an existing dedupeKey makes this a no-op
  });
}

export const enqueueEmail = (db: JobWriter, email: Email, tenantId?: string | null) =>
  enqueue(db, "email.send", email as unknown as Record<string, unknown>, { tenantId });

const DAY = 86_400_000;

// Handlers must be idempotent (JOB-03): a crash after the side effect but before the status update re-runs them.
const handlers = {
  "email.send": async (job: Job) => {
    await deliver(job.payload as unknown as Email);
    // The body may contain one-time links; keep only the envelope once sent.
    const { to, subject } = job.payload as unknown as Email;
    await prisma.job.update({ where: { id: job.id }, data: { payload: { to, subject, bodyRemoved: true } } });
  },
  "maintenance.cleanup": async () => {
    const now = new Date();
    await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * DAY) } } });
    await prisma.verification.deleteMany({ where: { expiresAt: { lt: now } } });
    await prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - DAY) } } });
    await prisma.job.deleteMany({ where: { status: "SUCCEEDED", updatedAt: { lt: new Date(now.getTime() - 30 * DAY) } } });
  },
} satisfies Record<string, (job: Job) => Promise<void>>;

export type JobType = keyof typeof handlers;

/** JOB-03: 30 s × 2^(attempt-1), capped at 6 h, ±20% jitter. */
export function backoffMs(attempt: number, random = Math.random()): number {
  const base = Math.min(30_000 * 2 ** (attempt - 1), 6 * 3_600_000);
  return Math.round(base * (0.8 + 0.4 * random));
}

export async function runJob(job: Job): Promise<void> {
  const handler = handlers[job.type as JobType];
  try {
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    await handler(job);
    await prisma.job.update({ where: { id: job.id }, data: { status: "SUCCEEDED", lockedAt: null, lockedBy: null, lastError: null } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const dead = job.attempts >= job.maxAttempts;
    await prisma.job.update({
      where: { id: job.id },
      data: dead
        ? { status: "DEAD", lastError: message, lockedAt: null, lockedBy: null }
        : { status: "QUEUED", lastError: message, lockedAt: null, lockedBy: null, runAt: new Date(Date.now() + backoffMs(job.attempts)) },
    });
    logger[dead ? "error" : "warn"]({ jobId: job.id, type: job.type, attempts: job.attempts, err: message }, dead ? "job dead" : "job failed, retrying");
  }
}

/** One worker tick: recover stuck jobs, schedule recurring ones, run what is due. Returns jobs processed. */
export async function tick(workerId: string, batch = 10): Promise<number> {
  await recoverStuckJobs(600);
  const day = new Date().toISOString().slice(0, 10);
  await enqueue(prisma, "maintenance.cleanup", {}, { dedupeKey: `maintenance.cleanup:${day}` }); // JOB-05
  const jobs = await claimJobs(workerId, batch);
  for (const job of jobs) await runJob(job);
  return jobs.length;
}
