# Architecture Decisions

Decisions taken for Phase 1, mapped to SPEC.md Appendix A (D-xx) or to the spec section they refine. Status values: **Accepted** (in force), **Deferred** (not needed until a later phase; default stands), **Review** (accepted for now, must be revisited before production).

## Phase 1 decisions

### ADR-01 Application shape — Accepted
One Next.js 16 application (App Router) plus one worker process (`src/worker.ts`) built from the same codebase. Business logic lives in a shared service layer under `src/modules/*/service.ts` and `src/server/*`. Route handlers under `/api/v1` and Server Components both call the same services (API-02). No microservices, no Server Actions for mutations.

### ADR-02 Authentication library (D-02) — Accepted, with deviations under Review
Better Auth 1.7 (maintained, MIT) handles email/password, server-side DB sessions, email verification, password reset, session listing/revocation and auth-endpoint rate limiting, through its Prisma adapter.

Configuration that satisfies the spec:
| Spec | How |
|---|---|
| AUTH-02 Argon2id | Custom `password.hash/verify` with `@node-rs/argon2` (m=19 MiB, t=2, p=1) |
| AUTH-03 policy | min 12 / max 128 + bundled common-password list, enforced in a `before` hook and in shared Zod schema |
| AUTH-04 generic errors + timing | Better Auth hashes a dummy password for unknown emails; errors are generic |
| AUTH-05 verification required | `requireEmailVerification: true`, 24 h token |
| AUTH-06 lockout | Own `RateLimitBucket` counters in `before`/`after` hooks on `/sign-in/email` (per account + per IP) |
| AUTH-10 idle/absolute | `expiresIn` = idle timeout with sliding refresh; absolute 7-day limit enforced in `getContext` |
| AUTH-13/18 | `revokeSessionsOnPasswordReset`, `revokeOtherSessions` on change; "password changed" email |
| AUTH-17 reset tokens | `verification.storeIdentifier: "hashed"`, 30 min expiry |
| AUTH-15 CSRF | Better Auth origin check on its endpoints; own Origin check on every non-GET `/api/v1` request |

Deviations (Review before production):
- **AUTH-09**: Better Auth stores the session token itself in the DB (not only a hash). The cookie value is HMAC-signed with `BETTER_AUTH_SECRET`, so a DB-only leak cannot be turned into a valid cookie without the secret. Cookie name is Better Auth's (`__Secure-` prefix in production), not `__Host-session`.
- **AUTH-12**: Session is rotated on login and password change. Switching the active tenant updates `activeTenantId` on the existing session instead of issuing a new session ID. The user does not gain privileges they did not already hold, so the fixation risk is nil, but it is recorded as a gap.
- **AUTH-05**: email verification tokens are signed JWTs (not stored), valid 24 h; re-using one is harmless (idempotent verify) but not strictly single-use.

### ADR-03 Database and migrations — Accepted
PostgreSQL 16, Prisma 7 (`prisma-client` generator, `@prisma/adapter-pg` driver adapter), migrations in `prisma/migrations`, applied with `prisma migrate deploy` as a separate step (MIG-01). Raw SQL appended to migrations for triggers and CHECK constraints (§21.5).
Deviation: table names are snake_case (`@@map`), column names stay camelCase (no per-column `@map`), to avoid hundreds of mapping annotations. Raw SQL quotes identifiers. Cosmetic only.

### ADR-04 Tenant isolation (TEN-*, D-01) — Accepted; RLS Deferred
- `tenantDb(tenantId)` — a Prisma Client extension that injects `tenantId` into every query on tenant-owned models and throws if a caller supplies a different one (TEN-03).
- Composite foreign keys `(tenantId, xId) → x(tenantId, id)` on tenant-to-tenant references (TEN-05).
- Cross-tenant ids return 404 (TEN-06).
- An automated isolation suite enumerates every `/api/v1` route file and attacks it with another tenant's ids (TEN-12 / TST-05).
- **D-01 Row-Level Security: Deferred to Phase 6.** Evaluated: RLS needs `SET LOCAL app.tenant_id` inside every transaction; with Prisma this means wrapping every request in an interactive transaction and a non-superuser DB role, which complicates pooling. The three layers above are mandatory now; RLS stays a candidate hardening item.

### ADR-05 Background jobs — Accepted
PostgreSQL `job` table claimed with `FOR UPDATE SKIP LOCKED`; exponential backoff with jitter; `DEAD` after `maxAttempts`; `dedupeKey` for idempotent scheduling; stuck-job recovery; recurring jobs scheduled by the worker loop (JOB-01..07). Emails are sent only by the worker.

### ADR-06 Configuration and secrets — Accepted (production storage: Review)
All environment variables are validated by a Zod schema at startup (`src/server/env.ts`, loaded by `instrumentation.ts` for the web app and directly by the worker); the process refuses to start on invalid configuration, and `EMAIL_PROVIDER=fake` is rejected in production. Local development uses `.env` (git-ignored, template in `.env.example`). Production uses the hosting platform's managed secret store injected as environment variables — choice tied to D-03.

### ADR-07 Rendering model — Accepted
`cacheComponents` is **disabled**. Every page of this product is per-user and per-tenant; Cache Components would require Suspense boundaries around every session read for no caching benefit. All app pages render dynamically. CSP nonces (SEC-03) are generated in `src/proxy.ts`, which requires dynamic rendering anyway.

### ADR-08 UI toolkit — Accepted (deviation from §24.1)
Phase 1 uses Tailwind CSS with native HTML elements (`<form>`, `<select>`, `<details>`, `<dialog>`) and a handful of local components instead of shadcn/ui + react-hook-form. Phase 1 screens are simple settings forms; native controls are accessible by default. Client-side validation uses the same Zod schemas as the server via a schema registry (FR-05). Revisit when complex tables/forms arrive in Phase 2 (TanStack Table, react-hook-form may be added then).

### ADR-09 Internationalization — Accepted (deviation from §24.7)
A ~40-line message helper (`src/lib/i18n.ts`) with `messages/ar.json` and `messages/en.json`, `Intl.PluralRules` for Arabic plural forms, and a test that both catalogs have identical keys. `next-intl` can replace it later without changing message files. Currencies and time zones come from `Intl.supportedValuesOf` instead of seeded tables (CUR-02 / LOC-02); country names from `Intl.DisplayNames`.

### ADR-10 File storage for Phase 1 — Accepted
S3-compatible object storage (MinIO locally). The only Phase 1 upload is the tenant logo (≤ 1 MB, PNG/JPEG/WebP detected by magic bytes), uploaded through an app route rather than a pre-signed POST (DOC-03 applies from Phase 4). SVG logos are not accepted until a sanitizer is added.

### ADR-11 Rate limiting — Accepted
`RateLimitBucket` fixed-window counters in PostgreSQL (SEC-14) for login lockout, signup, invitations and password reset; Better Auth's built-in limiter (database storage) covers its own endpoints. Ceiling: one DB write per limited request.

### ADR-12 Local S3 service — Accepted
MinIO stopped publishing container images in 2025, so local development and CI use SeaweedFS 4.48 (Apache-2.0) as the S3-compatible service, with development-only credentials in `docker/s3.json`. The application only speaks the S3 API (`@aws-sdk/client-s3`), so production can use any S3-compatible store.

### ADR-13 No configuration reads at import time — Accepted
The Prisma client and the Better Auth instance are created on first use (`prisma` is a lazy proxy and `getAuth()` is memoized). `next build` imports every route module, and Docker builds have no runtime secrets, so a build must never need `DATABASE_URL` or `BETTER_AUTH_SECRET`. Validation still happens at startup through `instrumentation.ts` and the worker's entry point.

### ADR-14 Local-only http exception — Accepted
`APP_URL` must be https in production, except for hostnames that are never public: `localhost`, `127.0.0.1` and `host.docker.internal` (used to run the production build and the E2E container locally). `upgrade-insecure-requests` is only sent when `APP_URL` is https.

### ADR-15 End-to-end tests in a container — Accepted
Playwright has no Chromium build for macOS 12, so E2E runs in `mcr.microsoft.com/playwright:v1.64.1-noble` against the host app. It runs serially with generous timeouts, because the development machine is slow. See README.

## Phase 2 decisions

### ADR-16 Field encryption — Accepted (KMS: Review, D-18)
AES-256-GCM per value (`v1:<keyId>:<nonce>:<ciphertext+tag>`), keys from `ENCRYPTION_KEYS` with `ENCRYPTION_ACTIVE_KEY_ID`, and an HMAC-SHA-256 lookup hash keyed by `HMAC_KEY` (SEC-10..12, CRM-07/08). Encrypted: travel document numbers (traveler profiles and booking passenger snapshots) and supplier IBANs. A passenger snapshot copies the traveler's ciphertext rather than decrypting and re-encrypting it. The re-encryption job for key rotation (SEC-11) is not built yet; `needsReencryption()` identifies the candidates.

### ADR-17 Reference data — Accepted (D-09 resolved)
Airports come from github.com/mwgg/Airports (MIT), filtered to the 7,522 entries with a valid IATA code and IANA timezone, and committed as `prisma/data/airports.json`. Airlines are a curated list of 61 carriers (`prisma/data/airlines.json`). Flight segments must use known airports; carrier codes are format-checked only, so unlisted airlines still work.

### ADR-18 Scope of tenant-wide reference records — Accepted
Suppliers and products have no branch. Any granted scope of `supplier:read` / `supplier:write` / `product:write` applies to all of them, because a BRANCH scope cannot apply to records without a branch (§4.6). This is a refinement of the §4.7 matrix.

### ADR-19 Sensitive reveals — Accepted
- Travel document numbers require `traveldoc:reveal` within its scope. OWN means the customer's owner for profiles and the booking's owner for passengers.
- Supplier IBANs can be revealed by holders of `supplier:write` with ALL scope (owner, admin, accountant) and by branch managers. The spec defines no IBAN permission, so this rule is my proposal: **Review**.
- Every reveal is audit-logged and served with `Cache-Control: no-store`.

### ADR-20 Booking money model — Accepted (Phase 3 review)
- Item amounts are **line totals** in the **booking currency**. `quantity` is informational.
- Per-item supplier currency and FX are deferred to supplier bills (Phase 3).
- Tax is computed per line and rounded half-up; tax-inclusive pricing is snapshotted from the tenant setting at booking creation.
- Cancellation and amendment fees are added to totals untaxed; their VAT treatment is decided at invoicing (Phase 3).
- `paidTotal` stays 0 until payments exist.

### ADR-21 Amendments — Accepted
Confirmed and issued bookings refuse direct edits (`AMENDMENT_REQUIRED`). An amendment is a stored list of operations (`updateItem`, `addItem`, `updatePassenger`) with fees; applying it re-validates every operation and runs them in one transaction, and the stored diff and price difference are kept. The UI exposes price, cost and confirmation-number changes; the API supports all three operation types.

### ADR-22 Idempotency — Accepted, deviation from IDM-04 (Review)
`Idempotency-Key` is accepted on the create endpoints (bookings, booking items, customers, suppliers, products, amendments). The key row is claimed before the handler runs and completed afterwards, not inside the business transaction (Prisma has no nested interactive transactions). The failure mode is safe: after a crash between the business commit and the key update, retries get 409 until the key expires (24 h). A duplicate can never be created.

### ADR-23 Test parallelism — Accepted
Vitest runs with `maxWorkers: 2`. Each worker hashes many Argon2id passwords, and more parallelism starved the 4-core development machine. Recurring-job tests use a job-type filter on `tick()`, so they never consume other test files' email jobs.

## Deferred to later phases (defaults from Appendix A stand)
| Decision | Phase | Note |
|---|---|---|
| D-03 Hosting / region | 6 | Requires D-05 legal review |
| D-04 ZATCA Phase 2 build vs middleware | 6 | |
| D-05 Data residency (PDPL) | before production | **Review** — blocks production launch, not development |
| D-06 Email provider | 3 | Phase 1 uses SMTP adapter; Mailpit locally |
| D-07 Plans/billing | 6 | Plans seeded with placeholder limits; manual billing |
| D-08 Breached-password API | — | Bundled list only |
| D-09 | 2 | **Resolved**: ADR-17 |
| D-10…D-20 | 3–6 | Defaults in SPEC.md Appendix A |

## Phase 1 scope trims (recorded so they are not mistaken for done)
- Team / TeamMember, IdempotencyKey and Notification tables are not created yet: nothing in Phase 1 reads or writes them. They arrive with their first consumer (Phase 2–4).
- Field-level encryption helpers (SEC-10) arrive in Phase 2 with the first encrypted field (travel documents).
- Per-tenant session idle timeout (AUTH-10 "configurable per tenant") — global `SESSION_IDLE_HOURS` in Phase 1.
- User-selectable light/dark override — Phase 1 follows `prefers-color-scheme`.
- MFA (AUTH-07) — Phase 6 per spec.
