import { afterEach, describe, expect, it, vi } from "vitest";

// ADR-06: invalid configuration stops startup; fake adapters are refused in production (INT-02).
const base = {
  APP_URL: "https://app.example.com", DATABASE_URL: "postgresql://x", BETTER_AUTH_SECRET: "s".repeat(40), S3_REGION: "r", S3_BUCKET: "bucket",
  S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp", SMTP_PORT: "587", EMAIL_FROM: "a@b.co",
  ENCRYPTION_KEYS: JSON.stringify({ k1: Buffer.alloc(32, 7).toString("base64") }), ENCRYPTION_ACTIVE_KEY_ID: "k1", HMAC_KEY: "h".repeat(40),
};

async function load(over: Record<string, string | undefined>) {
  vi.resetModules();
  const saved = { ...process.env };
  process.env = { ...base, NODE_ENV: "production", ...over } as NodeJS.ProcessEnv;
  try {
    const { env } = await import("@/server/env");
    return env();
  } finally {
    process.env = saved;
  }
}

describe("environment validation", () => {
  afterEach(() => vi.resetModules());
  it("accepts a complete production config", async () => {
    expect((await load({})).SESSION_IDLE_HOURS).toBe(8);
  });
  it("refuses the fake email provider, plain http and short secrets in production", async () => {
    await expect(load({ EMAIL_PROVIDER: "fake" })).rejects.toThrow(/EMAIL_PROVIDER/);
    await expect(load({ APP_URL: "http://app.example.com" })).rejects.toThrow(/APP_URL/);
    await expect(load({ BETTER_AUTH_SECRET: "short" })).rejects.toThrow(/BETTER_AUTH_SECRET/);
    await expect(load({ DATABASE_URL: undefined })).rejects.toThrow(/DATABASE_URL/);
    await expect(load({ ENCRYPTION_KEYS: '{"k1":"c2hvcnQ="}' })).rejects.toThrow(/ENCRYPTION_KEYS/);
    await expect(load({ ENCRYPTION_ACTIVE_KEY_ID: "missing" })).rejects.toThrow(/ENCRYPTION_ACTIVE_KEY_ID/);
  });
  it("allows skipping email verification only on a local APP_URL (AUTH-05)", async () => {
    await expect(load({ SKIP_EMAIL_VERIFICATION: "true" })).rejects.toThrow(/SKIP_EMAIL_VERIFICATION/);
    expect((await load({ SKIP_EMAIL_VERIFICATION: "true", APP_URL: "http://localhost:3000" })).SKIP_EMAIL_VERIFICATION).toBe(true);
    expect((await load({})).SKIP_EMAIL_VERIFICATION).toBe(false);
  });
});
