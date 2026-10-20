-- Trigram search (customers, travelers, passengers, suppliers).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'CORPORATE');

-- CreateEnum
CREATE TYPE "LifecycleStage" AS ENUM ('LEAD', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('PASSPORT', 'NATIONAL_ID', 'IQAMA', 'VISA', 'OTHER');

-- CreateEnum
CREATE TYPE "InteractionChannel" AS ENUM ('CALL', 'EMAIL', 'WHATSAPP', 'SMS', 'MEETING', 'NOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('AIRLINE', 'CONSOLIDATOR', 'HOTEL', 'HOTEL_WHOLESALER', 'DMC', 'TRANSFER', 'TOUR_OPERATOR', 'VISA_SERVICE', 'INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('FLIGHT', 'HOTEL', 'TRANSFER', 'TOUR', 'PACKAGE', 'VISA', 'INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('NET', 'COMMISSIONABLE');

-- CreateEnum
CREATE TYPE "TaxBasis" AS ENUM ('FULL_AMOUNT', 'SERVICE_FEE_ONLY');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'ON_HOLD', 'CONFIRMED', 'ISSUED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingItemStatus" AS ENUM ('REQUESTED', 'ON_REQUEST', 'HELD', 'CONFIRMED', 'ISSUED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaxType" AS ENUM ('ADT', 'CHD', 'INF');

-- CreateEnum
CREATE TYPE "AmendmentStatus" AS ENUM ('DRAFT', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "airport" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "timezone" TEXT NOT NULL,

    CONSTRAINT "airport_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "airline" (
    "code" VARCHAR(2) NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,

    CONSTRAINT "airline_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "idempotency_key" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "CustomerType" NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "nameAr" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "lifecycleStage" "LifecycleStage" NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT,
    "ownerId" UUID,
    "branchId" UUID NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "gender" TEXT,
    "dateOfBirth" DATE,
    "nationality" CHAR(2),
    "vatNumber" TEXT,
    "crNumber" TEXT,
    "address" TEXT,
    "creditLimit" DECIMAL(18,4),
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "preferredLocale" TEXT NOT NULL DEFAULT 'ar',
    "marketingConsentAt" TIMESTAMPTZ(3),
    "marketingSource" TEXT,
    "notes" TEXT,
    "mergedIntoId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contact" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "receivesInvoices" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traveler" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "title" TEXT,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "nameAr" TEXT,
    "gender" TEXT,
    "dateOfBirth" DATE,
    "nationality" CHAR(2),
    "phone" TEXT,
    "email" TEXT,
    "preferences" JSONB,
    "frequentFlyer" JSONB,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "traveler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_document" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "travelerId" UUID NOT NULL,
    "type" "DocType" NOT NULL,
    "numberEnc" TEXT NOT NULL,
    "numberHash" CHAR(64) NOT NULL,
    "numberLast4" VARCHAR(4) NOT NULL,
    "issuingCountry" CHAR(2),
    "nationality" CHAR(2),
    "issueDate" DATE,
    "expiryDate" DATE,
    "holderName" TEXT,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "travel_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interaction" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "bookingId" UUID,
    "channel" "InteractionChannel" NOT NULL,
    "direction" "Direction" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tag" (
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "customer_tag_pkey" PRIMARY KEY ("customerId","tagId")
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "SupplierType" NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "country" CHAR(2),
    "city" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "vatNumber" TEXT,
    "crNumber" TEXT,
    "defaultCurrency" CHAR(3) NOT NULL DEFAULT 'SAR',
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "prepaid" BOOLEAN NOT NULL DEFAULT false,
    "ibanEnc" TEXT,
    "ibanLast4" VARCHAR(4),
    "iataCode" VARCHAR(3),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_contact" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rule" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "serviceType" "ServiceType",
    "productId" UUID,
    "ratePercent" DECIMAL(7,4),
    "fixedAmount" DECIMAL(18,4),
    "currency" CHAR(3),
    "validFrom" DATE,
    "validTo" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "ServiceType" NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "descriptionEn" TEXT,
    "descriptionAr" TEXT,
    "defaultSupplierId" UUID,
    "defaultCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "defaultSell" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'SAR',
    "taxRateId" UUID,
    "pricingModel" "PricingModel" NOT NULL DEFAULT 'NET',
    "validFrom" DATE,
    "validTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_component" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "packageProductId" UUID NOT NULL,
    "componentProductId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "product_component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'DRAFT',
    "confirmedAt" TIMESTAMPTZ(3),
    "travelStartDate" DATE,
    "travelEndDate" DATE,
    "destinationSummary" TEXT,
    "currency" CHAR(3) NOT NULL,
    "exchangeRate" DECIMAL(20,10) NOT NULL DEFAULT 1,
    "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT false,
    "sellTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "costTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "commissionTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paidTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "customerNotes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_item" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "productId" UUID,
    "supplierId" UUID,
    "description" TEXT NOT NULL,
    "status" "BookingItemStatus" NOT NULL DEFAULT 'REQUESTED',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "optionDeadline" TIMESTAMPTZ(3),
    "supplierConfirmation" TEXT,
    "pnr" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "costAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sellAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "commissionAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "serviceFeeAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxRateId" UUID,
    "taxRateSnapshot" JSONB,
    "taxBasis" "TaxBasis" NOT NULL DEFAULT 'FULL_AMOUNT',
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pricingModel" "PricingModel" NOT NULL DEFAULT 'NET',
    "details" JSONB NOT NULL,
    "detailsVersion" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_passenger" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "travelerId" UUID,
    "paxType" "PaxType" NOT NULL,
    "title" TEXT,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "gender" TEXT,
    "dateOfBirth" DATE,
    "nationality" CHAR(2),
    "docType" "DocType",
    "docNumberEnc" TEXT,
    "docNumberHash" CHAR(64),
    "docLast4" VARCHAR(4),
    "docExpiry" DATE,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "infantOfPassengerId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_passenger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_item_passenger" (
    "tenantId" UUID NOT NULL,
    "bookingItemId" UUID NOT NULL,
    "bookingPassengerId" UUID NOT NULL,
    "ticketNumber" TEXT,
    "seat" TEXT,

    CONSTRAINT "booking_item_passenger_pkey" PRIMARY KEY ("bookingItemId","bookingPassengerId")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "bookingItemId" UUID,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "userId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_item_cancellation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bookingItemId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "supplierFee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "agencyFee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "expectedSupplierRefund" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cancelledById" UUID NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_item_cancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_amendment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "operations" JSONB NOT NULL,
    "changes" JSONB,
    "supplierFee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "agencyFee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "priceDifference" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "AmendmentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "appliedById" UUID,
    "appliedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_amendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itinerary_note" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "textEn" TEXT,
    "textAr" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itinerary_note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idempotency_key_expiresAt_idx" ON "idempotency_key"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_key_tenantId_id_key" ON "idempotency_key"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_key_tenantId_userId_key_key" ON "idempotency_key"("tenantId", "userId", "key");

-- CreateIndex
CREATE INDEX "customer_tenantId_phone_idx" ON "customer"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "customer_tenantId_email_idx" ON "customer"("tenantId", "email");

-- CreateIndex
CREATE INDEX "customer_tenantId_branchId_createdAt_idx" ON "customer"("tenantId", "branchId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "customer_displayName_idx" ON "customer" USING GIN ("displayName" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "customer_tenantId_id_key" ON "customer"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tenantId_code_key" ON "customer"("tenantId", "code");

-- CreateIndex
CREATE INDEX "customer_contact_tenantId_customerId_idx" ON "customer_contact"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_contact_tenantId_id_key" ON "customer_contact"("tenantId", "id");

-- CreateIndex
CREATE INDEX "traveler_tenantId_customerId_idx" ON "traveler"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "traveler_lastName_idx" ON "traveler" USING GIN ("lastName" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "traveler_tenantId_id_key" ON "traveler"("tenantId", "id");

-- CreateIndex
CREATE INDEX "travel_document_tenantId_numberHash_idx" ON "travel_document"("tenantId", "numberHash");

-- CreateIndex
CREATE INDEX "travel_document_tenantId_expiryDate_idx" ON "travel_document"("tenantId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "travel_document_tenantId_id_key" ON "travel_document"("tenantId", "id");

-- CreateIndex
CREATE INDEX "interaction_tenantId_customerId_occurredAt_idx" ON "interaction"("tenantId", "customerId", "occurredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "interaction_tenantId_id_key" ON "interaction"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tag_tenantId_id_key" ON "tag"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tag_tenantId_name_key" ON "tag"("tenantId", "name");

-- CreateIndex
CREATE INDEX "customer_tag_tenantId_tagId_idx" ON "customer_tag"("tenantId", "tagId");

-- CreateIndex
CREATE INDEX "supplier_nameEn_idx" ON "supplier" USING GIN ("nameEn" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_tenantId_id_key" ON "supplier"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_tenantId_code_key" ON "supplier"("tenantId", "code");

-- CreateIndex
CREATE INDEX "supplier_contact_tenantId_supplierId_idx" ON "supplier_contact"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_contact_tenantId_id_key" ON "supplier_contact"("tenantId", "id");

-- CreateIndex
CREATE INDEX "commission_rule_tenantId_supplierId_idx" ON "commission_rule"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "commission_rule_tenantId_id_key" ON "commission_rule"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_tenantId_id_key" ON "product"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_tenantId_code_key" ON "product"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "product_component_tenantId_id_key" ON "product_component"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_component_packageProductId_componentProductId_key" ON "product_component"("packageProductId", "componentProductId");

-- CreateIndex
CREATE INDEX "booking_tenantId_status_idx" ON "booking"("tenantId", "status");

-- CreateIndex
CREATE INDEX "booking_tenantId_travelStartDate_idx" ON "booking"("tenantId", "travelStartDate");

-- CreateIndex
CREATE INDEX "booking_tenantId_customerId_idx" ON "booking"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "booking_tenantId_branchId_createdAt_idx" ON "booking"("tenantId", "branchId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "booking_tenantId_id_key" ON "booking"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_tenantId_reference_key" ON "booking"("tenantId", "reference");

-- CreateIndex
CREATE INDEX "booking_item_tenantId_bookingId_idx" ON "booking_item"("tenantId", "bookingId");

-- CreateIndex
CREATE INDEX "booking_item_tenantId_supplierId_idx" ON "booking_item"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "booking_item_tenantId_status_optionDeadline_idx" ON "booking_item"("tenantId", "status", "optionDeadline");

-- CreateIndex
CREATE INDEX "booking_item_tenantId_startDate_idx" ON "booking_item"("tenantId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "booking_item_tenantId_id_key" ON "booking_item"("tenantId", "id");

-- CreateIndex
CREATE INDEX "booking_passenger_tenantId_bookingId_idx" ON "booking_passenger"("tenantId", "bookingId");

-- CreateIndex
CREATE INDEX "booking_passenger_tenantId_docNumberHash_idx" ON "booking_passenger"("tenantId", "docNumberHash");

-- CreateIndex
CREATE INDEX "booking_passenger_lastName_idx" ON "booking_passenger" USING GIN ("lastName" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "booking_passenger_tenantId_id_key" ON "booking_passenger"("tenantId", "id");

-- CreateIndex
CREATE INDEX "booking_item_passenger_tenantId_bookingPassengerId_idx" ON "booking_item_passenger"("tenantId", "bookingPassengerId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_item_passenger_tenantId_ticketNumber_key" ON "booking_item_passenger"("tenantId", "ticketNumber");

-- CreateIndex
CREATE INDEX "booking_status_history_tenantId_bookingId_createdAt_idx" ON "booking_status_history"("tenantId", "bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_status_history_tenantId_id_key" ON "booking_status_history"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_item_cancellation_tenantId_id_key" ON "booking_item_cancellation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_item_cancellation_tenantId_bookingItemId_key" ON "booking_item_cancellation"("tenantId", "bookingItemId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_amendment_tenantId_id_key" ON "booking_amendment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_amendment_bookingId_number_key" ON "booking_amendment"("bookingId", "number");

-- CreateIndex
CREATE INDEX "itinerary_note_tenantId_bookingId_date_idx" ON "itinerary_note"("tenantId", "bookingId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_note_tenantId_id_key" ON "itinerary_note"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_tenantId_ownerId_fkey" FOREIGN KEY ("tenantId", "ownerId") REFERENCES "membership"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_tenantId_mergedIntoId_fkey" FOREIGN KEY ("tenantId", "mergedIntoId") REFERENCES "customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact" ADD CONSTRAINT "customer_contact_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customer"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler" ADD CONSTRAINT "traveler_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_document" ADD CONSTRAINT "travel_document_tenantId_travelerId_fkey" FOREIGN KEY ("tenantId", "travelerId") REFERENCES "traveler"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag" ADD CONSTRAINT "tag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tag" ADD CONSTRAINT "customer_tag_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customer"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tag" ADD CONSTRAINT "customer_tag_tenantId_tagId_fkey" FOREIGN KEY ("tenantId", "tagId") REFERENCES "tag"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_contact" ADD CONSTRAINT "supplier_contact_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "supplier"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rule" ADD CONSTRAINT "commission_rule_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "supplier"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rule" ADD CONSTRAINT "commission_rule_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenantId_defaultSupplierId_fkey" FOREIGN KEY ("tenantId", "defaultSupplierId") REFERENCES "supplier"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenantId_taxRateId_fkey" FOREIGN KEY ("tenantId", "taxRateId") REFERENCES "tax_rate"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_component" ADD CONSTRAINT "product_component_tenantId_packageProductId_fkey" FOREIGN KEY ("tenantId", "packageProductId") REFERENCES "product"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_component" ADD CONSTRAINT "product_component_tenantId_componentProductId_fkey" FOREIGN KEY ("tenantId", "componentProductId") REFERENCES "product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_tenantId_ownerId_fkey" FOREIGN KEY ("tenantId", "ownerId") REFERENCES "membership"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_item" ADD CONSTRAINT "booking_item_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_item" ADD CONSTRAINT "booking_item_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_item" ADD CONSTRAINT "booking_item_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "supplier"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_item" ADD CONSTRAINT "booking_item_tenantId_taxRateId_fkey" FOREIGN KEY ("tenantId", "taxRateId") REFERENCES "tax_rate"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_passenger" ADD CONSTRAINT "booking_passenger_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_passenger" ADD CONSTRAINT "booking_passenger_tenantId_travelerId_fkey" FOREIGN KEY ("tenantId", "travelerId") REFERENCES "traveler"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_passenger" ADD CONSTRAINT "booking_passenger_tenantId_infantOfPassengerId_fkey" FOREIGN KEY ("tenantId", "infantOfPassengerId") REFERENCES "booking_passenger"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_item_passenger" ADD CONSTRAINT "booking_item_passenger_tenantId_bookingItemId_fkey" FOREIGN KEY ("tenantId", "bookingItemId") REFERENCES "booking_item"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_item_passenger" ADD CONSTRAINT "booking_item_passenger_tenantId_bookingPassengerId_fkey" FOREIGN KEY ("tenantId", "bookingPassengerId") REFERENCES "booking_passenger"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_item_cancellation" ADD CONSTRAINT "booking_item_cancellation_tenantId_bookingItemId_fkey" FOREIGN KEY ("tenantId", "bookingItemId") REFERENCES "booking_item"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_amendment" ADD CONSTRAINT "booking_amendment_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_note" ADD CONSTRAINT "itinerary_note_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Hand-written guards (SPEC §21.5) ─────────────
ALTER TABLE "booking_item" ADD CONSTRAINT booking_item_dates CHECK ("endDate" >= "startDate");
ALTER TABLE "booking_item" ADD CONSTRAINT booking_item_amounts CHECK (
  "costAmount" >= 0 AND "sellAmount" >= 0 AND "commissionAmount" >= 0 AND "serviceFeeAmount" >= 0
  AND "discountAmount" >= 0 AND "taxAmount" >= 0 AND "quantity" >= 1);
ALTER TABLE "booking" ADD CONSTRAINT booking_dates CHECK ("travelEndDate" IS NULL OR "travelEndDate" >= "travelStartDate");
ALTER TABLE "booking" ADD CONSTRAINT booking_rate_positive CHECK ("exchangeRate" > 0);
ALTER TABLE "booking_item_cancellation" ADD CONSTRAINT cancellation_fees CHECK ("supplierFee" >= 0 AND "agencyFee" >= 0 AND "expectedSupplierRefund" >= 0);
ALTER TABLE "booking_amendment" ADD CONSTRAINT amendment_fees CHECK ("supplierFee" >= 0 AND "agencyFee" >= 0);
ALTER TABLE "commission_rule" ADD CONSTRAINT commission_one_kind CHECK (("ratePercent" IS NULL) <> ("fixedAmount" IS NULL));
ALTER TABLE "commission_rule" ADD CONSTRAINT commission_values CHECK (("ratePercent" IS NULL OR ("ratePercent" >= 0 AND "ratePercent" <= 100)) AND ("fixedAmount" IS NULL OR "fixedAmount" >= 0));
ALTER TABLE "product" ADD CONSTRAINT product_amounts CHECK ("defaultCost" >= 0 AND "defaultSell" >= 0);
ALTER TABLE "product_component" ADD CONSTRAINT component_not_self CHECK ("packageProductId" <> "componentProductId" AND "quantity" >= 1);
ALTER TABLE "booking_passenger" ADD CONSTRAINT passenger_not_own_infant CHECK ("infantOfPassengerId" IS NULL OR "infantOfPassengerId" <> "id");
ALTER TABLE "customer" ADD CONSTRAINT customer_not_merged_into_self CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id");
