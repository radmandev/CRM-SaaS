import { z } from "zod";

// Validated once at startup (instrumentation.ts for the web app, worker.ts for the worker). §26.3, ADR-06.
const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    APP_URL: z.url(),
    DATABASE_URL: z.string().startsWith("postgres"),
    BETTER_AUTH_SECRET: z.string().min(32),
    SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(24).default(8),
    SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    // SEC-10/12: {"keyId":"<base64 32 bytes>", ...}, the active id for new writes, and the lookup-hash key.
    ENCRYPTION_KEYS: z.string().transform((v, ctx) => {
      try {
        const keys = Object.entries(JSON.parse(v) as Record<string, string>).map(([id, k]) => [id, Buffer.from(k, "base64")] as const);
        if (!keys.length || keys.some(([id, k]) => !/^[A-Za-z0-9_-]{1,20}$/.test(id) || k.length !== 32)) throw new Error();
        return new Map(keys);
      } catch {
        ctx.addIssue({ code: "custom", message: 'must be JSON {"id":"<base64 of 32 bytes>"}' });
        return z.NEVER;
      }
    }),
    ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
    HMAC_KEY: z.string().min(32),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool.default(false),
    EMAIL_PROVIDER: z.enum(["smtp", "fake"]),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_SECURE: bool.default(false),
    EMAIL_FROM: z.string().min(3),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (!env.ENCRYPTION_KEYS.has(env.ENCRYPTION_ACTIVE_KEY_ID))
      ctx.addIssue({ code: "custom", path: ["ENCRYPTION_ACTIVE_KEY_ID"], message: "must be one of the ENCRYPTION_KEYS ids" });
    // INT-02: fake adapters never run in production.
    if (env.NODE_ENV === "production" && env.EMAIL_PROVIDER === "fake")
      ctx.addIssue({ code: "custom", path: ["EMAIL_PROVIDER"], message: "fake is not allowed in production" });
    if (env.EMAIL_PROVIDER === "smtp" && (!env.SMTP_HOST || !env.SMTP_PORT))
      ctx.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "SMTP_HOST and SMTP_PORT are required for smtp" });
    // Local-only hostnames (never public) may use http, e.g. `next start` on a laptop or the E2E container.
    const local = ["localhost", "127.0.0.1", "host.docker.internal"].includes(new URL(env.APP_URL).hostname);
    if (env.NODE_ENV === "production" && !env.APP_URL.startsWith("https://") && !local)
      ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "must be https in production" });
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return (cached = parsed.data);
}
