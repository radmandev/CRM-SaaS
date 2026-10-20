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
});
