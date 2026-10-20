import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/env.ts"],
    testTimeout: 30_000,
    // Each worker hashes many Argon2id passwords (19 MiB each); more workers than this starves a 4-core machine.
    maxWorkers: 2,
    hookTimeout: 60_000,
  },
});
