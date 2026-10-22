import { hostname } from "node:os";
import { env } from "./server/env";
import { logger } from "./server/logger";
import { tick } from "./server/jobs";
import "./modules/documents/jobs"; // registers the PDF job handlers
import { prisma } from "./server/db";

// JOB-02: separate worker process. Safe to run several replicas (SKIP LOCKED).
env(); // ADR-06: refuse to start on invalid configuration
const workerId = `${hostname()}:${process.pid}`;
let stopping = false;

async function loop() {
  logger.info({ workerId }, "worker started");
  while (!stopping) {
    try {
      const processed = await tick(workerId);
      if (processed === 0) await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      logger.error({ err }, "worker tick failed");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await prisma.$disconnect();
  logger.info({ workerId }, "worker stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
  });

void loop();
