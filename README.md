# Travel Agency Management SaaS

Multi-tenant platform for travel agencies, starting with Saudi Arabia (Arabic RTL / English LTR, SAR, VAT, ZATCA-ready).

- **Specification:** [SPEC.md](SPEC.md). It is the source of truth; requirement IDs such as `TEN-03` are referenced in code and tests.
- **Architecture decisions:** [docs/architecture-decisions.md](docs/architecture-decisions.md)
- **Build status:** [BUILD_STATUS.md](BUILD_STATUS.md) lists what is implemented and verified, and what is not.

Current state: **Phase 1 (foundation)**, covering signup, authentication, tenant isolation, agency settings, users and roles, and the dashboard. Bookings, finance, AI and integrations are later phases.

## Stack

Next.js 16 (App Router) · TypeScript · PostgreSQL 16 · Prisma 7 · Better Auth (email/password, DB sessions, Argon2id) · Zod · Tailwind CSS 4 · Vitest · Playwright. There is one web app plus one worker process. The job queue and rate limits run on PostgreSQL, so there is no Redis.

## Run locally

Requirements: Node.js 22.12+ and Docker.

```bash
cp .env.example .env              # then set BETTER_AUTH_SECRET (command is in the file)
docker compose up -d postgres s3 mailpit
npm install                       # also generates the Prisma client
npm run db:migrate && npm run db:seed
npm run storage:init              # creates the S3 bucket (idempotent)
npm run dev                       # http://localhost:3000
npm run worker                    # second terminal: sends emails and runs scheduled jobs
```

Emails, including verification and invitation links, are captured by Mailpit at <http://localhost:8025>. Without the worker running, emails stay queued and you will not receive the verification link.

Sign up at `/signup`, open the verification email in Mailpit, and you land in the dashboard as the agency owner.

### Production build locally

```bash
npm run build
node .next/standalone/server.js   # needs the static assets: cp -r .next/static .next/standalone/.next/
```

`APP_URL` must be `https://…` in production; only `localhost`, `127.0.0.1` and `host.docker.internal` may use http.

### Everything in containers

```bash
cp .env.docker.example .env.docker   # set BETTER_AUTH_SECRET
docker compose --profile app up --build
```

This runs `migrate` (migrations + seed), then `app` on port 3000 and `worker`.

## Tests

```bash
npm run typecheck && npm run lint
npm test                          # unit + integration against the real PostgreSQL test database
```

Integration tests use the `travel_test` database, which is created by `docker/postgres-init.sql`. They rebuild its schema from the migrations on every run. Postgres and the S3 service must be up.

### End-to-end tests

Playwright drives a real browser against a running app, worker, DB, storage and Mailpit. The base URL must equal the server's `APP_URL`, because mutations are Origin-checked:

```bash
APP_URL=http://localhost:3000 npm run dev    # plus npm run worker
E2E_BASE_URL=http://localhost:3000 MAILPIT_URL=http://localhost:8025 npm run test:e2e
```

On macOS 12, where Playwright has no Chromium build, run the tests inside the official image against an app started with `APP_URL=http://host.docker.internal:3200`:

```bash
docker run --rm -v "$PWD":/work -w /work -e E2E_BASE_URL=http://host.docker.internal:3200 \
  -e MAILPIT_URL=http://host.docker.internal:8025 mcr.microsoft.com/playwright:v1.64.1-noble npx playwright test
```

## Project layout

```
prisma/                schema, migrations (with hand-written SQL guards), seed
src/app/               pages and /api/v1 route handlers (thin adapters)
src/modules/*/         services: business rules, authorization, audit
src/server/            auth, tenant-scoped DB (db/), raw SQL (db/raw/ only), jobs, env, permissions
src/lib/               shared client/server code: Zod schemas, i18n, formatting
src/worker.ts          background worker entry point
messages/              ar.json / en.json
tests/                 unit, integration (real Postgres), e2e (Playwright)
```

## Environment variables

All variables are documented in [.env.example](.env.example) and validated at startup by `src/server/env.ts`. The app refuses to start on invalid configuration, and the `fake` email provider is rejected in production.
