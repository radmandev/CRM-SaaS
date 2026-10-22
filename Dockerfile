# syntax=docker/dockerfile:1.7
# OPS-01: one image for the web app and the worker; a separate target runs migrations.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npx prisma generate \
 && npx next build \
 && npx esbuild src/worker.ts --bundle --platform=node --format=esm --target=node22 --packages=external --outfile=dist/worker.mjs \
 && npm prune --omit=dev

# Applies migrations and seeds reference data, then exits (MIG-01: never on app boot).
# (`npm ci` in deps already ran `prisma generate` via postinstall, which the seed script needs.)
FROM deps AS migrate
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts"]

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 CHROME_PATH=/usr/bin/chromium
# The worker renders PDFs with headless Chromium (ADR-12); the Arabic/Latin font is embedded from assets/.
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation && rm -rf /var/lib/apt/lists/* \
 && groupadd --system app && useradd --system --gid app --create-home app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist/worker.mjs ./worker.mjs
COPY --from=build --chown=app:app /app/assets ./assets
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
