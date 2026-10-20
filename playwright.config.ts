import { defineConfig, devices } from "@playwright/test";

// E2E against a running stack (app + worker + DB + storage + Mailpit). See README "End-to-end tests".
// E2E_BASE_URL must equal the server's APP_URL, because mutations are Origin-checked (AUTH-15).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 300_000,
  workers: 1,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
