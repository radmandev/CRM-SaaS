import { execSync } from "node:child_process";
import pg from "pg";

// Fresh schema per run: drop everything, apply the real migrations, seed reference data (MIG-03, MIG-05).
export default async function setup() {
  try {
    process.loadEnvFile();
  } catch {}
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://app:app@localhost:5432/travel_test";
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await client.end();
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}
