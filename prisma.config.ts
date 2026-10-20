import { defineConfig } from "prisma/config";

// ponytail: Node's built-in .env loader instead of dotenv. Missing file is fine (CI/containers pass real env vars).
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DATABASE_URL! },
});
