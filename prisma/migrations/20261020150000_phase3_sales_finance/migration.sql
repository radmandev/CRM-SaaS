-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('STANDARD', 'SIMPLIFIED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED');

-- CreateEnum
CREATE TYPE "ZatcaStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'CLEARED', 'REPORTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD_POS', 'ONLINE_GATEWAY', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('RECORDED', 'REVERSED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING_APPROVAL', 'RECORDED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK', 'GATEWAY_CLEARING');

-- AlterTable
ALTER TABLE "booking" ADD COLUMN     "approvedAt" TIMESTAMPTZ(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "quotationId" UUID,
ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "booking_item" ADD COLUMN     "invoicedQuantity" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "document" ADD COLUMN     "generated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "discountApprovalPercent" DECIMAL(7,4) NOT NULL DEFAULT 10,
ADD COLUMN     "expenseApprovalLimit" DECIMAL(18,4) NOT NULL DEFAULT 5000,
ADD COLUMN     "quotationTermsAr" TEXT,
ADD COLUMN     "quotationTermsEn" TEXT,
ADD COLUMN     "quotationValidityDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "refundSelfApproval" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "quotation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" TEXT,
    "versionNo" INTEGER NOT NULL DEFAULT 1,
    "rootId" UUID,
    "customerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "exchangeRate" DECIMAL(20,10) NOT NULL DEFAULT 1,
    "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT false,
    "sellTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "costTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "commissionTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "showItemPrices" BOOLEAN NOT NULL DEFAULT true,
    "termsEn" TEXT,
    "termsAr" TEXT,
    "notes" TEXT,
    "customerNotes" TEXT,
    "lostReason" TEXT,
    "lostNote" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "acceptedAt" TIMESTAMPTZ(3),
    "acceptanceNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_item" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "productId" UUID,
    "supplierId" UUID,
    "description" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
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

    CONSTRAINT "quotation_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "InvoiceKind" NOT NULL DEFAULT 'INVOICE',
    "type" "InvoiceType" NOT NULL,
    "number" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMPTZ(3),
    "supplyDate" DATE,
    "dueDate" DATE,
    "customerId" UUID NOT NULL,
    "customerSnapshot" JSONB,
    "sellerSnapshot" JSONB,
    "branchId" UUID NOT NULL,
    "bookingId" UUID,
    "originalId" UUID,
    "reason" TEXT,
    "currency" CHAR(3) NOT NULL,
    "exchangeRate" DECIMAL(20,10) NOT NULL DEFAULT 1,
    "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "baseTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amountCredited" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "zatcaUuid" UUID,
    "icv" INTEGER,
    "previousHash" TEXT,
    "invoiceHash" TEXT,
    "qrPayload" TEXT,
    "zatcaStatus" "ZatcaStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "pdfDocumentId" UUID,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "issuedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "bookingItemId" UUID,
    "originalLineId" UUID,
    "descriptionEn" TEXT NOT NULL,
    "descriptionAr" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxRateId" UUID,
    "taxRateSnapshot" JSONB NOT NULL,
    "netAmount" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_account" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "ibanEnc" TEXT,
    "ibanLast4" VARCHAR(4),
    "branchId" UUID,
    "openingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_transfer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "fromAccountId" UUID NOT NULL,
    "toAccountId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "fee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "bookingId" UUID,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "exchangeRate" DECIMAL(20,10) NOT NULL DEFAULT 1,
    "baseAmount" DECIMAL(18,4) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "financialAccountId" UUID NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'RECORDED',
    "reversedById" UUID,
    "reversedAt" TIMESTAMPTZ(3),
    "reversalReason" TEXT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),

    CONSTRAINT "payment_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "bookingId" UUID,
    "creditNoteId" UUID,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" UUID NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "paidAt" DATE,
    "reference" TEXT,
    "financialAccountId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bill" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "supplierInvoiceNumber" TEXT NOT NULL,
    "billDate" DATE NOT NULL,
    "dueDate" DATE,
    "currency" CHAR(3) NOT NULL,
    "exchangeRate" DECIMAL(20,10) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL,
    "baseTotal" DECIMAL(18,4) NOT NULL,
    "amountPaid" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'RECORDED',
    "reversedById" UUID,
    "reversedAt" TIMESTAMPTZ(3),
    "reversalReason" TEXT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bill_line" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "bookingItemId" UUID,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "supplier_bill_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "exchangeRate" DECIMAL(20,10) NOT NULL DEFAULT 1,
    "baseAmount" DECIMAL(18,4) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "financialAccountId" UUID NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'RECORDED',
    "reversedById" UUID,
    "reversedAt" TIMESTAMPTZ(3),
    "reversalReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment_allocation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),

    CONSTRAINT "supplier_payment_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_category" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "expense_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "branchId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "exchangeRate" DECIMAL(20,10) NOT NULL DEFAULT 1,
    "baseAmount" DECIMAL(18,4) NOT NULL,
    "financialAccountId" UUID NOT NULL,
    "payee" TEXT,
    "supplierId" UUID,
    "bookingId" UUID,
    "status" "ExpenseStatus" NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "reversedById" UUID,
    "reversedAt" TIMESTAMPTZ(3),
    "reversalReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotation_tenantId_status_validUntil_idx" ON "quotation"("tenantId", "status", "validUntil");

-- CreateIndex
CREATE INDEX "quotation_tenantId_customerId_idx" ON "quotation"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "quotation_tenantId_branchId_createdAt_idx" ON "quotation"("tenantId", "branchId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "quotation_tenantId_id_key" ON "quotation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_tenantId_number_versionNo_key" ON "quotation"("tenantId", "number", "versionNo");

-- CreateIndex
CREATE INDEX "quotation_item_tenantId_quotationId_idx" ON "quotation_item"("tenantId", "quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_item_tenantId_id_key" ON "quotation_item"("tenantId", "id");

-- CreateIndex
CREATE INDEX "invoice_tenantId_customerId_issuedAt_idx" ON "invoice"("tenantId", "customerId", "issuedAt");

-- CreateIndex
CREATE INDEX "invoice_tenantId_status_dueDate_idx" ON "invoice"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "invoice_tenantId_bookingId_idx" ON "invoice"("tenantId", "bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tenantId_id_key" ON "invoice"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tenantId_kind_number_key" ON "invoice"("tenantId", "kind", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tenantId_zatcaUuid_key" ON "invoice"("tenantId", "zatcaUuid");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tenantId_icv_key" ON "invoice"("tenantId", "icv");

-- CreateIndex
CREATE INDEX "invoice_line_tenantId_invoiceId_idx" ON "invoice_line"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "invoice_line_tenantId_bookingItemId_idx" ON "invoice_line"("tenantId", "bookingItemId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_line_tenantId_id_key" ON "invoice_line"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_account_tenantId_id_key" ON "financial_account"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_account_tenantId_name_key" ON "financial_account"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "account_transfer_tenantId_id_key" ON "account_transfer"("tenantId", "id");

-- CreateIndex
CREATE INDEX "payment_tenantId_customerId_date_idx" ON "payment"("tenantId", "customerId", "date");

-- CreateIndex
CREATE INDEX "payment_tenantId_bookingId_idx" ON "payment"("tenantId", "bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_tenantId_id_key" ON "payment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_tenantId_number_key" ON "payment"("tenantId", "number");

-- CreateIndex
CREATE INDEX "payment_allocation_tenantId_invoiceId_idx" ON "payment_allocation"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "payment_allocation_tenantId_paymentId_idx" ON "payment_allocation"("tenantId", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocation_tenantId_id_key" ON "payment_allocation"("tenantId", "id");

-- CreateIndex
CREATE INDEX "refund_tenantId_customerId_idx" ON "refund"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "refund_tenantId_status_idx" ON "refund"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "refund_tenantId_id_key" ON "refund"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_tenantId_number_key" ON "refund"("tenantId", "number");

-- CreateIndex
CREATE INDEX "supplier_bill_tenantId_billDate_idx" ON "supplier_bill"("tenantId", "billDate");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bill_tenantId_id_key" ON "supplier_bill"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bill_tenantId_supplierId_supplierInvoiceNumber_key" ON "supplier_bill"("tenantId", "supplierId", "supplierInvoiceNumber");

-- CreateIndex
CREATE INDEX "supplier_bill_line_tenantId_billId_idx" ON "supplier_bill_line"("tenantId", "billId");

-- CreateIndex
CREATE INDEX "supplier_bill_line_tenantId_bookingItemId_idx" ON "supplier_bill_line"("tenantId", "bookingItemId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bill_line_tenantId_id_key" ON "supplier_bill_line"("tenantId", "id");

-- CreateIndex
CREATE INDEX "supplier_payment_tenantId_supplierId_date_idx" ON "supplier_payment"("tenantId", "supplierId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_tenantId_id_key" ON "supplier_payment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_tenantId_number_key" ON "supplier_payment"("tenantId", "number");

-- CreateIndex
CREATE INDEX "supplier_payment_allocation_tenantId_billId_idx" ON "supplier_payment_allocation"("tenantId", "billId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_allocation_tenantId_id_key" ON "supplier_payment_allocation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_category_tenantId_id_key" ON "expense_category"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_category_tenantId_nameEn_key" ON "expense_category"("tenantId", "nameEn");

-- CreateIndex
CREATE INDEX "expense_tenantId_date_idx" ON "expense"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "expense_tenantId_id_key" ON "expense"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_tenantId_number_key" ON "expense"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "booking_tenantId_quotationId_key" ON "booking"("tenantId", "quotationId");

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_tenantId_quotationId_fkey" FOREIGN KEY ("tenantId", "quotationId") REFERENCES "quotation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_tenantId_rootId_fkey" FOREIGN KEY ("tenantId", "rootId") REFERENCES "quotation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_tenantId_ownerId_fkey" FOREIGN KEY ("tenantId", "ownerId") REFERENCES "membership"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_item" ADD CONSTRAINT "quotation_item_tenantId_quotationId_fkey" FOREIGN KEY ("tenantId", "quotationId") REFERENCES "quotation"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_item" ADD CONSTRAINT "quotation_item_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_item" ADD CONSTRAINT "quotation_item_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "supplier"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_item" ADD CONSTRAINT "quotation_item_tenantId_taxRateId_fkey" FOREIGN KEY ("tenantId", "taxRateId") REFERENCES "tax_rate"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenantId_originalId_fkey" FOREIGN KEY ("tenantId", "originalId") REFERENCES "invoice"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenantId_pdfDocumentId_fkey" FOREIGN KEY ("tenantId", "pdfDocumentId") REFERENCES "document"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "invoice"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenantId_bookingItemId_fkey" FOREIGN KEY ("tenantId", "bookingItemId") REFERENCES "booking_item"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenantId_originalLineId_fkey" FOREIGN KEY ("tenantId", "originalLineId") REFERENCES "invoice_line"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transfer" ADD CONSTRAINT "account_transfer_tenantId_fromAccountId_fkey" FOREIGN KEY ("tenantId", "fromAccountId") REFERENCES "financial_account"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transfer" ADD CONSTRAINT "account_transfer_tenantId_toAccountId_fkey" FOREIGN KEY ("tenantId", "toAccountId") REFERENCES "financial_account"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenantId_financialAccountId_fkey" FOREIGN KEY ("tenantId", "financialAccountId") REFERENCES "financial_account"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_tenantId_paymentId_fkey" FOREIGN KEY ("tenantId", "paymentId") REFERENCES "payment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "invoice"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_tenantId_creditNoteId_fkey" FOREIGN KEY ("tenantId", "creditNoteId") REFERENCES "invoice"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_tenantId_financialAccountId_fkey" FOREIGN KEY ("tenantId", "financialAccountId") REFERENCES "financial_account"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill" ADD CONSTRAINT "supplier_bill_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "supplier"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill_line" ADD CONSTRAINT "supplier_bill_line_tenantId_billId_fkey" FOREIGN KEY ("tenantId", "billId") REFERENCES "supplier_bill"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill_line" ADD CONSTRAINT "supplier_bill_line_tenantId_bookingItemId_fkey" FOREIGN KEY ("tenantId", "bookingItemId") REFERENCES "booking_item"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "supplier"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_tenantId_financialAccountId_fkey" FOREIGN KEY ("tenantId", "financialAccountId") REFERENCES "financial_account"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT "supplier_payment_allocation_tenantId_paymentId_fkey" FOREIGN KEY ("tenantId", "paymentId") REFERENCES "supplier_payment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT "supplier_payment_allocation_tenantId_billId_fkey" FOREIGN KEY ("tenantId", "billId") REFERENCES "supplier_bill"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_category" ADD CONSTRAINT "expense_category_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_tenantId_categoryId_fkey" FOREIGN KEY ("tenantId", "categoryId") REFERENCES "expense_category"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_tenantId_financialAccountId_fkey" FOREIGN KEY ("tenantId", "financialAccountId") REFERENCES "financial_account"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "supplier"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── Hand-written guards (SPEC FR-10, FIN-04, §21.5) ─────────────

-- Generic guard: the row may not be deleted, and only the columns named in TG_ARGV may change.
CREATE FUNCTION protect_financial_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are immutable and cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - TG_ARGV) IS DISTINCT FROM (to_jsonb(OLD) - TG_ARGV) THEN
    RAISE EXCEPTION '% rows are immutable; only % may change', TG_TABLE_NAME, TG_ARGV USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- Issued invoices and credit notes: only derived balances, e-invoicing status and the PDF link change.
CREATE TRIGGER invoice_issued_immutable BEFORE UPDATE OR DELETE ON "invoice"
  FOR EACH ROW WHEN (OLD."status" = 'ISSUED')
  EXECUTE FUNCTION protect_financial_row('amountPaid', 'amountCredited', 'zatcaStatus', 'pdfDocumentId', 'updatedAt');

CREATE FUNCTION invoice_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT "status" FROM "invoice" WHERE "id" = OLD."invoiceId") = 'ISSUED' THEN
    RAISE EXCEPTION 'lines of an issued invoice are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER invoice_line_issued_immutable BEFORE UPDATE OR DELETE ON "invoice_line"
  FOR EACH ROW EXECUTE FUNCTION invoice_line_guard();

CREATE TRIGGER payment_immutable BEFORE UPDATE OR DELETE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION protect_financial_row('status', 'reversedById', 'reversedAt', 'reversalReason', 'updatedAt');
CREATE TRIGGER payment_allocation_immutable BEFORE UPDATE OR DELETE ON "payment_allocation"
  FOR EACH ROW EXECUTE FUNCTION protect_financial_row('releasedAt');
CREATE TRIGGER supplier_payment_immutable BEFORE UPDATE OR DELETE ON "supplier_payment"
  FOR EACH ROW EXECUTE FUNCTION protect_financial_row('status', 'reversedById', 'reversedAt', 'reversalReason', 'updatedAt');
CREATE TRIGGER supplier_payment_allocation_immutable BEFORE UPDATE OR DELETE ON "supplier_payment_allocation"
  FOR EACH ROW EXECUTE FUNCTION protect_financial_row('releasedAt');
CREATE TRIGGER supplier_bill_immutable BEFORE UPDATE OR DELETE ON "supplier_bill"
  FOR EACH ROW EXECUTE FUNCTION protect_financial_row('amountPaid', 'status', 'reversedById', 'reversedAt', 'reversalReason', 'updatedAt');
CREATE TRIGGER supplier_bill_line_immutable BEFORE UPDATE OR DELETE ON "supplier_bill_line"
  FOR EACH ROW EXECUTE FUNCTION protect_financial_row();
CREATE TRIGGER refund_immutable BEFORE UPDATE OR DELETE ON "refund"
  FOR EACH ROW EXECUTE FUNCTION protect_financial_row('status', 'approvedById', 'approvedAt', 'decisionNote', 'paidAt', 'reference', 'financialAccountId', 'updatedAt');
CREATE TRIGGER expense_immutable BEFORE UPDATE OR DELETE ON "expense"
  FOR EACH ROW EXECUTE FUNCTION protect_financial_row('status', 'approvedById', 'approvedAt', 'reversedById', 'reversedAt', 'reversalReason', 'updatedAt');
CREATE TRIGGER account_transfer_immutable BEFORE UPDATE OR DELETE ON "account_transfer"
  FOR EACH ROW EXECUTE FUNCTION protect_financial_row();

-- Value checks.
ALTER TABLE "payment" ADD CONSTRAINT payment_positive CHECK ("amount" > 0 AND "baseAmount" > 0 AND "exchangeRate" > 0);
ALTER TABLE "payment_allocation" ADD CONSTRAINT allocation_positive CHECK ("amount" > 0);
ALTER TABLE "supplier_payment" ADD CONSTRAINT supplier_payment_positive CHECK ("amount" > 0 AND "exchangeRate" > 0);
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT supplier_allocation_positive CHECK ("amount" > 0);
ALTER TABLE "refund" ADD CONSTRAINT refund_positive CHECK ("amount" > 0);
ALTER TABLE "expense" ADD CONSTRAINT expense_amounts CHECK ("amount" > 0 AND "taxAmount" >= 0 AND "exchangeRate" > 0);
ALTER TABLE "supplier_bill" ADD CONSTRAINT bill_amounts CHECK ("total" >= 0 AND "taxAmount" >= 0 AND "amountPaid" >= 0 AND "amountPaid" <= "total");
ALTER TABLE "invoice" ADD CONSTRAINT invoice_amounts CHECK ("total" >= 0 AND "taxAmount" >= 0 AND "amountPaid" >= 0 AND "amountCredited" >= 0 AND "amountCredited" <= "total");
ALTER TABLE "invoice" ADD CONSTRAINT credit_note_has_original CHECK ("kind" = 'INVOICE' OR ("originalId" IS NOT NULL AND "reason" IS NOT NULL));
ALTER TABLE "invoice" ADD CONSTRAINT issued_has_number CHECK ("status" = 'DRAFT' OR ("number" IS NOT NULL AND "issuedAt" IS NOT NULL AND "zatcaUuid" IS NOT NULL AND "icv" IS NOT NULL));
ALTER TABLE "account_transfer" ADD CONSTRAINT transfer_valid CHECK ("fromAccountId" <> "toAccountId" AND "amount" > 0 AND "fee" >= 0);
ALTER TABLE "booking_item" ADD CONSTRAINT invoiced_quantity_range CHECK ("invoicedQuantity" >= 0);
ALTER TABLE "tenant" ADD CONSTRAINT tenant_finance_settings CHECK ("discountApprovalPercent" >= 0 AND "discountApprovalPercent" <= 100 AND "expenseApprovalLimit" >= 0 AND "quotationValidityDays" BETWEEN 1 AND 365);

-- Defaults for agencies created before Phase 3 (new agencies get them at signup).
INSERT INTO "financial_account" ("id", "tenantId", "name", "type", "currency")
  SELECT gen_random_uuid(), t."id", n.name, n.type::"AccountType", t."baseCurrency" FROM "tenant" t
  CROSS JOIN (VALUES ('Cash box', 'CASH'), ('Main bank account', 'BANK')) AS n(name, type);
INSERT INTO "expense_category" ("id", "tenantId", "nameEn", "nameAr")
  SELECT gen_random_uuid(), t."id", c.en, c.ar FROM "tenant" t
  CROSS JOIN (VALUES ('Rent', 'الإيجار'), ('Salaries', 'الرواتب'), ('Utilities', 'المرافق'), ('Marketing', 'التسويق'), ('Software', 'البرمجيات'),
                     ('Bank charges', 'رسوم بنكية'), ('Government fees', 'رسوم حكومية'), ('Other', 'أخرى')) AS c(en, ar);
