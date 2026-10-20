# Build Status — Phase 1 (Application Foundation)

Updated: 2026-10-20. Source of truth: [SPEC.md](SPEC.md) §27 Phase 1. Decisions: [docs/architecture-decisions.md](docs/architecture-decisions.md).

**Summary:** Phase 1 is implemented and verified locally. Checks run: typecheck, lint, 126 unit and integration tests against real PostgreSQL, a browser E2E journey on desktop and mobile with axe scans, a production build without secrets, and a Docker image smoke test. The CI workflow exists but has not run, because the repository has no remote. Phases 2–6 have not started.

## 1. Implemented requirements

| Area | Requirement IDs | Notes |
|---|---|---|
| Multi-tenancy | TEN-01, 02, 03, 04, 05, 06, 07, 08 (n/a yet), 09, 11, 12 | `tenantDb()` Prisma extension; composite FKs; 404 for foreign ids; raw SQL only in `src/server/db/raw/` (lint-enforced) |
| Authentication | AUTH-01..06, 09..11, 13..23 | Better Auth with Argon2id and DB sessions. Deviations from AUTH-09 and AUTH-12 are listed in §6 |
| Authorization | AUTHZ-01..03, §4.6 scopes, full §4.7 matrix encoded | `src/server/permissions.ts`; server-side on every route |
| Onboarding & settings | §5.1, ONB-02, §5.2, §5.3 (logo + accent color), BR-01, BR-02 (members), BR-04, CUR-02..05, LOC-01..07, TAX-01, TAX-02, TAX-04 (setting), NUM-01..04 | ONB-01 is enforced in Phase 3 (no invoices yet); BR-03 applies once bookings and invoices exist |
| Users & invitations | AUTH-19..23, EMP-01 (partial: there are no owned records to reassign yet), EMP-02 | Role-grant rules, branch scope, last-owner guard |
| Dashboard | §15.1 Phase 1 tiles, DSH-01 (counts link to settings) | Built from live queries; tested against DB changes |
| Audit | AUD-01, 02, 03, 04 (Phase 1 events) | Append-only trigger (UPDATE, DELETE, TRUNCATE) |
| Jobs | JOB-01..06 | PostgreSQL queue with SKIP LOCKED, backoff, DEAD state, dedupe, stuck-job recovery, daily cleanup |
| API conventions | API-01, 02, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13; §22.8 health | problem+json errors, keyset pagination, strict query params |
| Security | SEC-01 (partial), 02, 03, 04, 05, 07, 13, 14 | CSP with nonce; HSTS; no `dangerouslySetInnerHTML` (lint); Postgres rate limits |
| i18n / UX | FR-01 (search and pagination on lists), FR-02 (audit), FR-05, FR-06, FR-07, KSA-01..03, KSA-05..08, UX-01..05, UX-07, §24.6 | Arabic RTL and English LTR; 338 keys in each language |
| Ops | OPS-01, 02, 03, 07 (logging), §26.3 env validation, MIG-01, 02 (documented), 03 (local), 05 | Dockerfile (runtime and migrate targets), compose, `.env.example` |

## 2. Key files

| Purpose | Path |
|---|---|
| Schema, migration with SQL guards, seed | `prisma/schema.prisma`, `prisma/migrations/*_init/migration.sql`, `prisma/seed.ts` |
| Tenant-scoped DB, raw SQL | `src/server/db/index.ts`, `src/server/db/raw/*` |
| Auth config and hooks (lockout, password policy) | `src/server/auth.ts`, `src/server/password.ts` |
| Request context, route wrapper | `src/server/context.ts`, `src/server/api.ts` |
| Permissions | `src/server/permissions.ts` |
| Services | `src/modules/{tenancy,settings,identity,dashboard,audit}/service.ts` |
| Shared validation, i18n | `src/lib/schemas.ts`, `src/lib/i18n.ts`, `messages/{ar,en}.json` |
| Jobs and worker | `src/server/jobs.ts`, `src/worker.ts` |
| CSP and security headers | `src/proxy.ts`, `next.config.ts` |
| Tests | `tests/unit`, `tests/integration`, `tests/e2e`, `tests/helpers.ts` |

## 3. Commands run and their results (2026-10-19/20, macOS 12, Node 22.18, Docker 24)

| Command | Result |
|---|---|
| `npx prisma migrate dev` (dev DB) | Migration `init` applied |
| `npx prisma migrate diff --from-config-datasource --to-schema …` | Empty: no drift, and the hand-written index is preserved |
| `npx prisma db seed` | 4 plans seeded (idempotent) |
| `npx tsc --noEmit` | 0 errors |
| `npx eslint` | 0 errors, 0 warnings in `src/` (custom rules verified to fire on probe files) |
| `npx vitest run` (3 consecutive runs) | **9 files, 126 tests passed** each time |
| `npx next build` with `.env` removed | Succeeds; all routes dynamic |
| Production server + worker (`next start`, `npm run worker`) | `/api/health/ready` returns ok (database, migrations, storage); CSP, HSTS and nosniff headers present |
| Playwright E2E in `mcr.microsoft.com/playwright:v1.64.1-noble` (desktop + Pixel 7) | **2 passed**: sign up, real verification email via Mailpit, settings save, invitation, acceptance in Arabic, role-restricted navigation and API 403. axe found no serious or critical issues on 11 pages |
| `docker build --target runtime` + `docker run` (web, `node worker.mjs`) | Health ok, `/login` returns 200, CSS returns 200, worker started, runs as uid 999 (non-root); image 1.16 GB |
| `docker build --target migrate` + run | "No pending migrations", "Seeded 4 plans" |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` (including dev) | 5 high, all in the `eslint-config-next` → `fast-glob` → `braces` chain (lint tooling only). npm's suggested "fix" is a downgrade to v14, so it was not applied |

## 4. Database migration status

There is one migration (`init`), applied to `travel` (dev). The test DB `travel_test` is rebuilt from the migrations on every test run. Hand-written SQL in the migration: the audit append-only triggers, CHECK constraints (tax rate range, positive FX rate, different currencies, sequence ≥ 1, document size, job attempts), and a unique index on pending invitations per email.

## 5. Tests by suite

| Suite | Tests | Covers |
|---|---|---|
| `integration/auth` | 14 | Signup/verify, no account probing, password policy, generic login errors, lockout and its email, cookie flags, logout revocation, idle and absolute expiry, CSRF Origin check, hashed reset tokens, single use, session revocation on reset and change |
| `integration/tenant-isolation` (TST-05) | 9 | Discovers every `/api/v1` route on disk. Every `[id]` route returns 404 to tenant B and tenant A's rows are byte-identical afterwards. List routes leak no tenant-A identifiers. Smuggled `tenantId` and foreign branch ids are rejected. Also covers the tenantDb extension, composite FKs, and a schema/`TENANT_MODELS` sync check |
| `integration/authorization` (TST-06) | 63 | 7 roles × 8 permission routes; AUTH-19/23 grants; branch scope; deactivation takes effect on the next request; last-owner guard |
| `integration/platform` | 18 | Dashboard from persisted data; plan limits under concurrency; branch rules; invitation lifecycle (hash-only token, resend invalidates the old link, revoked, expired, single-use under a race, existing users, tenant switching); gapless numbering under 20 concurrent transactions and rollback; prefix lock; audit diff and append-only; KSA validation; logo magic bytes and per-tenant access; job delivery, payload scrubbing, retry → DEAD, dedupe; health |
| `unit/*` | 22 | Permission matrix cells, i18n key parity and placeholders, schemas (KSA formats, password, slug, color contrast, unknown-field stripping), backoff, diff, cursors, image sniffing, timezone/Hijri formatting, production env refusal |
| `e2e/onboarding` | 2 (desktop, mobile) | Full Phase 1 journey in a real browser with axe |

## 6. Known issues and deviations (need review)

1. **AUTH-09:** session tokens are stored by Better Auth in the DB (the cookie is HMAC-signed, so a DB leak alone cannot forge a cookie). The cookie name is Better Auth's, not `__Host-session`. Recorded in ADR-02.
2. **AUTH-12:** switching tenants updates the existing session instead of rotating its ID. Recorded in ADR-02.
3. **The login rate limit per IP trusts `X-Forwarded-For`.** In production the app must sit behind a proxy that overwrites this header; otherwise an attacker can rotate IPs. The per-account lock is unaffected.
4. **One unexplained signup failure in an early E2E run.** One signup returned "A referenced record does not exist" (DB foreign-key error) while two browsers signed up at the same time. Compensation left no orphan user. It was not reproduced afterwards: 6 parallel curl signups, 3 E2E runs and 3 full test runs all passed. Constraint errors and failed tenant creation are now logged with details. **Watch the logs; root cause not confirmed.**
5. One-time links (verification, reset, invitation) sit in the `job` payload until the worker sends them (seconds). The payload is scrubbed after sending.
6. `/api/auth/list-sessions` (Better Auth) returns the user's own session tokens to their browser, which revoking a session needs. Tokens are useless without the signing secret.
7. `next start` warns that it does not match `output: "standalone"`. It works; the Docker image uses `node server.js` as intended.
8. Five high-severity advisories in dev-only lint tooling (see §3).
9. Development S3 (SeaweedFS) and Mailpit use fixed development credentials. Never reuse them outside local or CI.

## 7. Unresolved decisions

These are tracked in SPEC Appendix A and the ADR file. The ones blocking **production**, not further development:
- D-05 data residency and PDPL review.
- D-03 hosting and region.
- D-06 production email provider.
- D-04 ZATCA Phase 2 approach (needed in Phase 6).
- D-07 plans and billing.
- Tax adviser review of the seeded VAT treatment (TAX-03).

## 8. Phase 1 acceptance criteria (SPEC §27)

| Criterion | Status |
|---|---|
| New agency can sign up, verify, configure profile, branches, tax and numbering, and invite users who log in with their role, in Arabic and English | **Met.** E2E covers signup → verify → settings → invite → accept (Arabic) → role-restricted UI; integration tests cover branches, tax, numbering and FX via the API |
| Agency B cannot read or modify any agency A resource through any Phase 1 route | **Met.** TST-05 is green and discovers new routes automatically |
| Password reset, session revocation on password change, lockout per AUTH-06/13/17 | **Met** (`integration/auth`) |
| Every settings change appears in the audit log with actor and diff | **Met** for agency, branches, tax rates, FX, numbering, members and invitations; the logo upload records metadata (size, type) instead of a diff |
| Docker Compose brings up the full stack with one command | **Partly verified.** Both images build and run (runtime and migrate targets tested individually against the compose services). The combined `docker compose --profile app up` was not run, because port 3000 on this machine is held by a Next dev server I did not start |
| CI gates pass | **Not verified.** `.github/workflows/ci.yml` is written; every gate passes locally, but the workflow has never run (no remote) |

### Phase 1 deliverables not done (deferred deliberately; see the ADR "scope trims")
- Team/TeamMember, IdempotencyKey and Notification tables: nothing uses them before Phases 2–4.
- OpenAPI document (API-14) and its CI check.
- Per-tenant session idle timeout (a global setting exists), manual light/dark toggle, MFA (Phase 6), RLS (D-01, Phase 6), field encryption helpers (Phase 2, with travel documents).
- Platform-admin bootstrap (`PLATFORM_ADMIN_EMAILS`): the admin console is Phase 6.

## 9. Run locally

```bash
cp .env.example .env    # set BETTER_AUTH_SECRET
docker compose up -d postgres s3 mailpit
npm install
npm run db:migrate && npm run db:seed && npm run storage:init
npm run dev             # http://localhost:3000
npm run worker          # second terminal; emails appear at http://localhost:8025
npm test                # unit + integration
```

Full details, including production build, containers and E2E: [README.md](README.md).
