// Test configuration. Real PostgreSQL (TST-01); the email adapter is the fake one (allowed only in tests, INT-02).
try {
  process.loadEnvFile();
} catch {}
const testDb = process.env.TEST_DATABASE_URL ?? "postgresql://app:app@localhost:5432/travel_test";
Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: testDb,
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
  EMAIL_PROVIDER: "fake",
  EMAIL_FROM: "Test <test@example.com>",
  S3_BUCKET: "travel-test",
  LOG_LEVEL: "silent",
  SKIP_EMAIL_VERIFICATION: "false", // a local demo .env must never weaken the AUTH-05 tests
  ENCRYPTION_KEYS: JSON.stringify({ k1: Buffer.alloc(32, 1).toString("base64"), k2: Buffer.alloc(32, 2).toString("base64") }),
  ENCRYPTION_ACTIVE_KEY_ID: "k2",
  HMAC_KEY: "test-hmac-key-test-hmac-key-test-hmac-key",
});
