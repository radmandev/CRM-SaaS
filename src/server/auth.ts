import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prisma } from "./db";
import { env } from "./env";
import { hashPassword, verifyPassword } from "./password";
import { enqueueEmail } from "./jobs";
import { emails } from "./emails";
import { password as passwordSchema } from "@/lib/schemas";
import { hit, peek, clear } from "./db/raw/rate-limit";

const LOCK_WINDOW = 15 * 60; // AUTH-06
const MAX_ACCOUNT_FAILURES = 10;
const MAX_IP_ATTEMPTS = 50;

// Built on first use, not at import: `next build` imports route modules without runtime secrets.
function createAuth() {
  const e = env();
  return betterAuth({
  appName: "Travel Agency SaaS",
  baseURL: e.APP_URL,
  secret: e.BETTER_AUTH_SECRET,
  trustedOrigins: [e.APP_URL],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  telemetry: { enabled: false },
  advanced: { database: { generateId: false }, useSecureCookies: e.APP_URL.startsWith("https://") },
  // Signup goes through /api/v1/signup (creates user + agency). Profile, email and session edits go through /api/v1.
  disabledPaths: ["/sign-up/email", "/update-user", "/update-session", "/change-email", "/delete-user", "/sign-in/social", "/link-social"],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true, // AUTH-05
    minPasswordLength: 12,
    maxPasswordLength: 128,
    autoSignIn: false,
    resetPasswordTokenExpiresIn: 30 * 60, // AUTH-17
    revokeSessionsOnPasswordReset: true, // AUTH-18
    password: { hash: hashPassword, verify: verifyPassword }, // AUTH-02
    sendResetPassword: async ({ user, url }) => {
      await enqueueEmail(prisma, emails.resetPassword((user as { locale?: string }).locale ?? "ar", user.email, url));
    },
    onPasswordReset: async ({ user }) => {
      await enqueueEmail(prisma, emails.passwordChanged((user as { locale?: string }).locale ?? "ar", user.email));
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 24 * 3600,
    sendVerificationEmail: async ({ user, url }) => {
      await enqueueEmail(prisma, emails.verifyEmail((user as { locale?: string }).locale ?? "ar", user.email, url));
    },
  },
  session: {
    expiresIn: e.SESSION_IDLE_HOURS * 3600, // AUTH-10 idle timeout, refreshed on activity (sliding)
    updateAge: 60, // write lastSeen at most once a minute
    additionalFields: { activeTenantId: { type: "string", required: false, input: false } },
  },
  user: {
    additionalFields: { locale: { type: "string", required: false, defaultValue: "ar", input: true } },
  },
  verification: { storeIdentifier: "hashed" },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/request-password-reset": { window: 3600, max: 5 },
      "/send-verification-email": { window: 3600, max: 5 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      // AUTH-03 on every path that sets a password.
      const newPassword = ctx.path === "/sign-up/email" ? body.password : ctx.path === "/reset-password" || ctx.path === "/change-password" ? body.newPassword : undefined;
      if (newPassword !== undefined && !passwordSchema.safeParse(newPassword).success)
        throw new APIError("BAD_REQUEST", { code: "WEAK_PASSWORD", message: "Password does not meet the policy" });

      if (ctx.path === "/sign-in/email") {
        const email = String(body.email ?? "").toLowerCase();
        const ip = ctx.request?.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
        const locked = (await peek(`login:acct:${email}`, LOCK_WINDOW)) >= MAX_ACCOUNT_FAILURES;
        const ipCount = await hit(`login:ip:${ip}`, LOCK_WINDOW);
        // Same generic response whether or not the account exists (AUTH-04, AUTH-06).
        if (locked || ipCount > MAX_IP_ATTEMPTS)
          throw new APIError("TOO_MANY_REQUESTS", { code: "TOO_MANY_ATTEMPTS", message: "Too many attempts. Try again later." });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const email = String((ctx.body as Record<string, unknown>)?.email ?? "").toLowerCase();
      if (ctx.context.newSession) {
        await clear(`login:acct:${email}`);
        return;
      }
      const failures = await hit(`login:acct:${email}`, LOCK_WINDOW);
      if (failures === MAX_ACCOUNT_FAILURES) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (user) await enqueueEmail(prisma, emails.accountLocked(user.locale, user.email));
      }
    }),
  },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;
export const getAuth = () => (instance ??= createAuth());

export type AuthSession = NonNullable<Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>>;
