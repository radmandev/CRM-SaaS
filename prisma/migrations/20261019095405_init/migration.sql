-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'BRANCH_MANAGER', 'SALES_AGENT', 'OPERATIONS_AGENT', 'ACCOUNTANT', 'VIEWER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaxCategory" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'DEAD');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'PLATFORM_SUPPORT');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "activeTenantId" UUID,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" UUID NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(3),
    "refreshTokenExpiresAt" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "rate_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_bucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limit_bucket_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateTable
CREATE TABLE "plan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "entitlements" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "runAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "lastError" TEXT,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIALING',
    "planId" UUID NOT NULL,
    "trialEndsAt" TIMESTAMPTZ(3),
    "legalNameEn" TEXT NOT NULL,
    "legalNameAr" TEXT,
    "tradeNameEn" TEXT,
    "tradeNameAr" TEXT,
    "country" CHAR(2) NOT NULL DEFAULT 'SA',
    "crNumber" TEXT,
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "vatNumber" TEXT,
    "vatRegisteredAt" DATE,
    "tourismLicenseNumber" TEXT,
    "addressBuilding" TEXT,
    "addressStreet" TEXT,
    "addressDistrict" TEXT,
    "addressCity" TEXT,
    "addressPostalCode" TEXT,
    "addressAdditionalNumber" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "baseCurrency" CHAR(3) NOT NULL DEFAULT 'SAR',
    "enabledCurrencies" TEXT[] DEFAULT ARRAY['SAR']::TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    "defaultLocale" TEXT NOT NULL DEFAULT 'ar',
    "weekStartsOn" INTEGER NOT NULL DEFAULT 0,
    "showHijri" BOOLEAN NOT NULL DEFAULT false,
    "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT false,
    "primaryColor" TEXT NOT NULL DEFAULT '#0f766e',
    "documentFooterEn" TEXT,
    "documentFooterAr" TEXT,
    "numberingPrefixes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "timezone" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "primaryBranchId" UUID NOT NULL,
    "jobTitle" TEXT,
    "phone" TEXT,
    "employeeCode" TEXT,
    "deactivatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_branch" (
    "tenantId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "branchId" UUID NOT NULL,

    CONSTRAINT "membership_branch_pkey" PRIMARY KEY ("membershipId","branchId")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "branchIds" UUID[],
    "tokenHash" TEXT NOT NULL,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "rate" DECIMAL(7,4) NOT NULL,
    "category" "TaxCategory" NOT NULL,
    "zatcaCode" CHAR(1) NOT NULL,
    "exemptionReasonCode" TEXT,
    "exemptionReasonText" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "fromCurrency" CHAR(3) NOT NULL,
    "toCurrency" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequence" (
    "tenantId" UUID NOT NULL,
    "series" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "number_sequence_pkey" PRIMARY KEY ("tenantId","series","year")
);

-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "category" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "actorType" "ActorType" NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "parentEntityType" TEXT,
    "parentEntityId" UUID,
    "changes" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_key_key" ON "rate_limit"("key");

-- CreateIndex
CREATE UNIQUE INDEX "plan_code_key" ON "plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "job_dedupeKey_key" ON "job"("dedupeKey");

-- CreateIndex
CREATE INDEX "job_status_runAt_idx" ON "job"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "branch_tenantId_id_key" ON "branch"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_tenantId_code_key" ON "branch"("tenantId", "code");

-- CreateIndex
CREATE INDEX "membership_userId_idx" ON "membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "membership_tenantId_id_key" ON "membership"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_tenantId_userId_key" ON "membership"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "membership_tenantId_employeeCode_key" ON "membership"("tenantId", "employeeCode");

-- CreateIndex
CREATE INDEX "membership_branch_tenantId_branchId_idx" ON "membership_branch"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_tokenHash_key" ON "invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "invitation_tenantId_email_idx" ON "invitation"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_tenantId_id_key" ON "invitation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rate_tenantId_id_key" ON "tax_rate"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rate_tenantId_code_key" ON "tax_rate"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rate_tenantId_id_key" ON "exchange_rate"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rate_tenantId_fromCurrency_toCurrency_effectiveDat_key" ON "exchange_rate"("tenantId", "fromCurrency", "toCurrency", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "document_storageKey_key" ON "document"("storageKey");

-- CreateIndex
CREATE INDEX "document_tenantId_entityType_entityId_idx" ON "document"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "document_tenantId_id_key" ON "document"("tenantId", "id");

-- CreateIndex
CREATE INDEX "audit_log_tenantId_entityType_entityId_createdAt_idx" ON "audit_log"("tenantId", "entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_log_tenantId_actorId_createdAt_idx" ON "audit_log"("tenantId", "actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_log_tenantId_createdAt_idx" ON "audit_log"("tenantId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch" ADD CONSTRAINT "branch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenantId_primaryBranchId_fkey" FOREIGN KEY ("tenantId", "primaryBranchId") REFERENCES "branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_branch" ADD CONSTRAINT "membership_branch_tenantId_membershipId_fkey" FOREIGN KEY ("tenantId", "membershipId") REFERENCES "membership"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_branch" ADD CONSTRAINT "membership_branch_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rate" ADD CONSTRAINT "tax_rate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_sequence" ADD CONSTRAINT "number_sequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Hand-written guards (SPEC §21.5) ─────────────

-- AUD-03: audit log is append-only.
CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (%)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- Value checks the application also validates (defence in depth).
ALTER TABLE "tax_rate" ADD CONSTRAINT tax_rate_rate_range CHECK ("rate" >= 0 AND "rate" <= 100);
ALTER TABLE "exchange_rate" ADD CONSTRAINT exchange_rate_positive CHECK ("rate" > 0 AND "fromCurrency" <> "toCurrency");
ALTER TABLE "number_sequence" ADD CONSTRAINT number_sequence_positive CHECK ("nextValue" >= 1);
ALTER TABLE "document" ADD CONSTRAINT document_size_positive CHECK ("size" > 0);
ALTER TABLE "job" ADD CONSTRAINT job_attempts_range CHECK ("attempts" >= 0 AND "maxAttempts" >= 1);

-- At most one pending invitation per email per tenant.
CREATE UNIQUE INDEX invitation_one_pending_per_email ON "invitation" ("tenantId", lower("email"))
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;
