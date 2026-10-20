import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { AppError, notFound, unauthenticated } from "./errors";
import { TenantScopeViolation } from "./db";
import { authorize, requireTenant, requireUser, resolveUser, type Ctx, type UserCtx } from "./context";
import { env } from "./env";
import { logger } from "./logger";
import { hit } from "./db/raw/rate-limit";
import type { Permission } from "./permissions";
import { fieldErrors } from "@/lib/validation";
import { negotiateLocale, translator, type Locale } from "@/lib/i18n";

type Params = Record<string, string>;
type RouteContext = { params: Promise<Params> };

type Handler<C, B, Q> = (a: { req: Request; ctx: C; body: B; query: Q; params: Params }) => Promise<unknown>;

type Options<B, Q> = { permission?: Permission; body?: z.ZodType<B>; query?: z.ZodType<Q>; idempotent?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API_LIMIT_PER_MINUTE = 600; // SEC-14

/** A response with an explicit status, e.g. 201 for creates. */
export class Reply {
  constructor(readonly status: number, readonly body: unknown) {}
}
export const created = (body: unknown) => new Reply(201, body);

function problem(err: AppError, requestId: string, t: ReturnType<typeof translator>): Response {
  const body = {
    type: `about:blank#${err.code}`,
    title: t(`error.${err.code}`) === `error.${err.code}` ? err.message : t(`error.${err.code}`),
    status: err.status,
    code: err.code,
    requestId,
    ...(err.errors.length ? { errors: err.errors } : {}),
    ...err.extra,
  };
  return Response.json(body, { status: err.status, headers: { "content-type": "application/problem+json", "x-request-id": requestId, ...err.headers } });
}

/** AUTH-15: state-changing requests must come from our own origin. */
function checkOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  const ok = origin ? origin === new URL(env().APP_URL).origin : site === "same-origin";
  if (!ok) throw new AppError(403, "BAD_ORIGIN", "Cross-origin request rejected");
}

function mapError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof TenantScopeViolation) return notFound(); // TEN-06
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Constraint errors that reach the API usually mean a missed validation; keep the evidence.
    if (err.code === "P2002" || err.code === "P2003") logger.warn({ code: err.code, meta: err.meta, message: err.message }, "database constraint rejected request");
    if (err.code === "P2025") return notFound();
    if (err.code === "P2002") return new AppError(409, "ALREADY_EXISTS", "A record with these values already exists");
    if (err.code === "P2003") return new AppError(422, "INVALID_REFERENCE", "A referenced record does not exist");
  }
  return null;
}

async function run<C extends UserCtx | null, B, Q>(
  kind: "public" | "user" | "tenant",
  opts: Options<B, Q>,
  handler: Handler<C, B, Q>,
  req: Request,
  rc: RouteContext,
): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const started = Date.now();
  let locale: Locale = negotiateLocale(req.headers.get("accept-language"));
  let ctx: UserCtx | Ctx | null = null;
  let status = 500;
  try {
    checkOrigin(req);
    ctx = kind === "tenant" ? await requireTenant(req.headers) : kind === "user" ? await requireUser(req.headers) : await resolveUser(req.headers);
    if (kind !== "public" && !ctx) throw unauthenticated();
    if (ctx) {
      locale = ctx.user.locale;
      if ((await hit(`api:user:${ctx.user.id}`, 60)) > API_LIMIT_PER_MINUTE)
        throw new AppError(429, "RATE_LIMITED", "Too many requests", [], { "retry-after": "60" });
    }
    if (opts.permission) authorize(ctx as Ctx, opts.permission);

    const params = (await rc?.params) ?? {};
    // Ids that are not UUIDs can never exist; answer 404 without touching the DB.
    for (const [k, v] of Object.entries(params)) if ((k === "id" || k.endsWith("Id")) && !UUID.test(v)) throw notFound();

    const t = translator(locale);
    let body = undefined as B;
    let rawBody = "";
    if (opts.body) {
      rawBody = await req.text();
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        throw new AppError(400, "MALFORMED_JSON", "Request body must be valid JSON");
      }
      const parsed = opts.body.safeParse(json);
      if (!parsed.success) throw new AppError(422, "VALIDATION_FAILED", "Validation failed", fieldErrors(parsed.error, t));
      body = parsed.data;
    }
    let query = undefined as Q;
    if (opts.query) {
      const parsed = opts.query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
      if (!parsed.success) throw new AppError(400, "INVALID_QUERY", "Invalid query parameters", fieldErrors(parsed.error, t));
      query = parsed.data;
    }

    const exec = () => handler({ req, ctx: ctx as C, body, query, params });
    const result = opts.idempotent && kind === "tenant" ? await idempotent(ctx as Ctx, req, rawBody, exec) : await exec();
    if (result instanceof Response) return ((status = result.status), result);
    const reply = result instanceof Reply ? result : result === undefined ? new Reply(204, null) : new Reply(200, result);
    status = reply.status;
    return reply.status === 204
      ? new Response(null, { status: 204, headers: { "x-request-id": requestId } })
      : Response.json(reply.body, { status: reply.status, headers: { "x-request-id": requestId } });
  } catch (err) {
    const known = mapError(err);
    if (known) {
      status = known.status;
      return problem(known, requestId, translator(locale));
    }
    logger.error({ err, requestId, path: new URL(req.url).pathname }, "unhandled error"); // API-10: details only in logs
    return problem(new AppError(500, "INTERNAL", "Something went wrong"), requestId, translator(locale));
  } finally {
    const tenantId = ctx && "tenant" in ctx ? (ctx as Ctx).tenant.id : undefined;
    logger.info({ requestId, method: req.method, path: new URL(req.url).pathname, status, ms: Date.now() - started, userId: ctx?.user.id, tenantId }, "request");
  }
}

const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;

/**
 * §20.3 IDM-01..03. The key row is claimed before the handler runs, so two identical requests can never both
 * execute; the stored response is replayed afterwards. Failed requests release the key so they can be retried.
 * Deviation from IDM-04 (same transaction): a crash between the business commit and the completion update
 * leaves the key IN_PROGRESS, so retries get 409 until it expires (24 h). That fails closed: never a duplicate.
 */
async function idempotent(ctx: Ctx, req: Request, rawBody: string, exec: () => Promise<unknown>): Promise<unknown> {
  const key = req.headers.get("idempotency-key");
  if (!key) return exec();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new AppError(400, "INVALID_IDEMPOTENCY_KEY", "Invalid Idempotency-Key");
  const route = `${req.method} ${new URL(req.url).pathname}`;
  const requestHash = createHash("sha256").update(`${route}\n${rawBody}`).digest("hex");
  try {
    await ctx.db.idempotencyKey.create({ data: { tenantId: ctx.tenant.id, userId: ctx.user.id, key, route, requestHash, expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS) } });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    const existing = await ctx.db.idempotencyKey.findFirst({ where: { userId: ctx.user.id, key } });
    if (!existing) throw err;
    if (existing.requestHash !== requestHash) throw new AppError(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used for a different request");
    if (existing.status === "IN_PROGRESS") throw new AppError(409, "REQUEST_IN_PROGRESS", "The original request is still being processed");
    return Response.json(existing.responseBody, { status: existing.responseStatus ?? 200, headers: { "idempotent-replayed": "true" } });
  }
  try {
    const result = await exec();
    const reply = result instanceof Reply ? result : new Reply(200, result ?? null);
    await ctx.db.idempotencyKey.updateMany({ where: { userId: ctx.user.id, key }, data: { status: "COMPLETED", responseStatus: reply.status, responseBody: reply.body as Prisma.InputJsonValue } });
    return reply;
  } catch (err) {
    await ctx.db.idempotencyKey.deleteMany({ where: { userId: ctx.user.id, key, status: "IN_PROGRESS" } });
    throw err;
  }
}

/** Route handler for tenant-scoped endpoints (the default). */
export const tenantRoute = <B = undefined, Q = undefined>(opts: Options<B, Q>, handler: Handler<Ctx, B, Q>) =>
  (req: Request, rc: RouteContext) => run("tenant", opts, handler, req, rc);

/** Route handler for endpoints that need a logged-in user but not a tenant (profile, tenant switch). */
export const userRoute = <B = undefined, Q = undefined>(opts: Options<B, Q>, handler: Handler<UserCtx, B, Q>) =>
  (req: Request, rc: RouteContext) => run("user", opts, handler, req, rc);

/** Route handler for public endpoints (signup, invitation lookup). Context is the user if logged in. */
export const publicRoute = <B = undefined, Q = undefined>(opts: Options<B, Q>, handler: Handler<UserCtx | null, B, Q>) =>
  (req: Request, rc: RouteContext) => run("public", opts, handler, req, rc);
