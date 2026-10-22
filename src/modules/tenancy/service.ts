import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma, Prisma, type TenantTx } from "@/server/db";
import { getAuth } from "@/server/auth";
import { env } from "@/server/env";
import { audit, diff } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { AppError, unprocessable } from "@/server/errors";
import { enqueueEmail } from "@/server/jobs";
import { emails } from "@/server/emails";
import { getObject, putObject } from "@/server/storage";
import { hit } from "@/server/db/raw/rate-limit";
import { logger } from "@/server/logger";
import { nextSequenceValue } from "@/server/db/raw/sequences";
import { DEFAULT_PREFIXES, SERIES, type agencySchema, type numberingSchema, type signupSchema } from "@/lib/schemas";
import type { financeSettingsSchema } from "@/lib/schemas-finance";

const TRIAL_DAYS = 14;

// TAX-02: KSA defaults. Treatment of each travel service must still be reviewed by a tax adviser (TAX-03).
const KSA_TAX_RATES = [
  { code: "VAT15", nameEn: "VAT 15%", nameAr: "ضريبة القيمة المضافة 15%", rate: "15", category: "STANDARD", zatcaCode: "S" },
  { code: "ZERO", nameEn: "Zero-rated", nameAr: "خاضع لنسبة الصفر", rate: "0", category: "ZERO_RATED", zatcaCode: "Z" },
  { code: "EXEMPT", nameEn: "Exempt", nameAr: "معفى", rate: "0", category: "EXEMPT", zatcaCode: "E" },
  { code: "OUT", nameEn: "Out of scope", nameAr: "خارج نطاق الضريبة", rate: "0", category: "OUT_OF_SCOPE", zatcaCode: "O" },
] as const;

const EXPENSE_CATEGORIES = [
  ["Rent", "الإيجار"], ["Salaries", "الرواتب"], ["Utilities", "المرافق"], ["Marketing", "التسويق"], ["Software", "البرمجيات"],
  ["Bank charges", "رسوم بنكية"], ["Government fees", "رسوم حكومية"], ["Other", "أخرى"],
] as const;

/**
 * Self-service signup (§5.1). Creates the user through Better Auth (which queues the verification email),
 * then the tenant, head-office branch, owner membership and seed data in one transaction.
 * An already-registered email gets the same response plus an email, so signup cannot probe accounts.
 */
export async function signup(input: z.infer<typeof signupSchema>, ip: string) {
  if ((await hit(`signup:ip:${ip}`, 3600)) > 20) throw new AppError(429, "RATE_LIMITED", "Too many requests");

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    await enqueueEmail(prisma, emails.signupExisting(existing.locale, existing.email, `${env().APP_URL}/login`));
    return { status: "verification_sent" as const };
  }
  if (await prisma.tenant.findUnique({ where: { slug: input.slug } })) throw unprocessable("SLUG_TAKEN", "This agency address is taken", "slug");

  const { user } = await getAuth().api.signUpEmail({
    body: { name: input.name, email: input.email, password: input.password, locale: input.locale, callbackURL: "/verified" },
  });
  try {
    await createTenant(user.id, input);
  } catch (err) {
    logger.error({ err, userId: user.id }, "tenant creation failed after user signup; removing the user");
    await prisma.user.delete({ where: { id: user.id } }); // compensate: no user without an agency
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw unprocessable("SLUG_TAKEN", "This agency address is taken", "slug");
    throw err;
  }
  return { status: "verification_sent" as const };
}

async function createTenant(userId: string, input: z.infer<typeof signupSchema>) {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "TRIAL" } });
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        slug: input.slug,
        legalNameEn: input.agencyName,
        country: input.country,
        defaultLocale: input.locale,
        planId: plan.id,
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
        enabledCurrencies: ["SAR", "USD"],
        numberingPrefixes: DEFAULT_PREFIXES,
      },
    });
    const branch = await tx.branch.create({ data: { tenantId: tenant.id, code: "HO", nameEn: "Head Office", nameAr: "المكتب الرئيسي" } });
    const membership = await tx.membership.create({
      data: { tenantId: tenant.id, userId, role: "OWNER", primaryBranchId: branch.id, branches: { create: { branchId: branch.id } } },
    });
    await tx.taxRate.createMany({ data: KSA_TAX_RATES.map((r) => ({ ...r, tenantId: tenant.id })) });
    // §11.7/11.8 defaults (same as the Phase 3 migration does for existing agencies).
    await tx.financialAccount.createMany({ data: ([{ name: "Cash box", type: "CASH" }, { name: "Main bank account", type: "BANK" }] as const).map((a) => ({ ...a, tenantId: tenant.id, currency: tenant.baseCurrency })) });
    await tx.expenseCategory.createMany({ data: EXPENSE_CATEGORIES.map(([nameEn, nameAr]) => ({ tenantId: tenant.id, nameEn, nameAr })) });
    // CUR-05: USD/SAR official peg, editable.
    await tx.exchangeRate.create({ data: { tenantId: tenant.id, fromCurrency: "USD", toCurrency: "SAR", rate: "3.75", effectiveDate: new Date(new Date().toISOString().slice(0, 10)) } });
    const actor = { type: "USER" as const, id: userId };
    await audit(tx, { tenantId: tenant.id, actor, action: "tenant.created", entityType: "Tenant", entityId: tenant.id, metadata: { slug: tenant.slug } });
    await audit(tx, { tenantId: tenant.id, actor, action: "membership.created", entityType: "Membership", entityId: membership.id, metadata: { role: "OWNER" } });
    return tenant;
  });
}

const AGENCY_FIELDS = [
  "legalNameEn", "legalNameAr", "tradeNameEn", "tradeNameAr", "country", "crNumber", "vatRegistered", "vatNumber", "vatRegisteredAt",
  "tourismLicenseNumber", "addressBuilding", "addressStreet", "addressDistrict", "addressCity", "addressPostalCode", "addressAdditionalNumber",
  "phone", "email", "website", "baseCurrency", "enabledCurrencies", "timezone", "defaultLocale", "weekStartsOn", "showHijri",
  "pricesIncludeTax", "primaryColor", "documentFooterEn", "documentFooterAr",
] as const;

export async function getAgency(ctx: Pick<Ctx, "db" | "tenant">) {
  const t = await ctx.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id } });
  return {
    ...(Object.fromEntries(AGENCY_FIELDS.map((k) => [k, t[k]])) as Pick<typeof t, (typeof AGENCY_FIELDS)[number]>),
    vatRegisteredAt: t.vatRegisteredAt?.toISOString().slice(0, 10) ?? null,
    slug: t.slug,
    status: t.status,
    trialEndsAt: t.trialEndsAt,
  };
}

export async function updateAgency(ctx: Ctx, input: z.infer<typeof agencySchema>) {
  authorize(ctx, "tenant:settings");
  const data = { ...input, vatNumber: input.vatRegistered ? input.vatNumber : input.vatNumber ?? null, vatRegisteredAt: input.vatRegisteredAt ? new Date(input.vatRegisteredAt) : null };
  // ponytail: base currency is freely editable until Phase 3 adds financial documents; then CUR-01 locks it.
  await ctx.db.$transaction(async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id } });
    await tx.tenant.update({ where: { id: ctx.tenant.id }, data });
    const changes = diff(before as unknown as Record<string, unknown>, data);
    if (changes) await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "tenant.settings_updated", entityType: "Tenant", entityId: ctx.tenant.id, changes });
  });
  return getAgency(ctx);
}

// ───────── Logo (§5.3, ADR-10) ─────────

const MAX_LOGO_BYTES = 1024 * 1024;

/** Detects the image type from magic bytes (DOC-01); the client's declared type is ignored. */
export function sniffImage(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  const b = bytes;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function uploadLogo(ctx: Ctx, file: File) {
  authorize(ctx, "tenant:settings");
  if (file.size === 0 || file.size > MAX_LOGO_BYTES) throw unprocessable("FILE_TOO_LARGE", "Logo must be at most 1 MB", "logo");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = sniffImage(bytes);
  if (!mimeType) throw unprocessable("FILE_TYPE_NOT_ALLOWED", "Logo must be PNG, JPEG or WebP", "logo");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = crypto.randomUUID();
  const storageKey = `tenants/${ctx.tenant.id}/logo/${id}`; // TEN-09, DOC-06
  await putObject(storageKey, bytes, mimeType);
  return ctx.db.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: { id, tenantId: ctx.tenant.id, storageKey, filename: file.name.slice(0, 200), mimeType, size: bytes.length, sha256, category: "LOGO", entityType: "Tenant", entityId: ctx.tenant.id, uploadedById: ctx.user.id },
    });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "tenant.logo_uploaded", entityType: "Document", entityId: doc.id, parentEntityType: "Tenant", parentEntityId: ctx.tenant.id, metadata: { size: doc.size, mimeType } });
    return { id: doc.id, mimeType, size: doc.size };
  });
}

export async function getLogo(ctx: Pick<Ctx, "db">) {
  const doc = await ctx.db.document.findFirst({ where: { category: "LOGO", entityType: "Tenant" }, orderBy: { createdAt: "desc" } });
  if (!doc) return null;
  return { body: await getObject(doc.storageKey), mimeType: doc.mimeType, sha256: doc.sha256 };
}

// ───────── Numbering (§5.8) ─────────

export async function getNumbering(db: TenantTx, tenantId: string) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { numberingPrefixes: true } });
  const used = await db.numberSequence.findMany({ select: { series: true }, distinct: ["series"] });
  const prefixes = { ...DEFAULT_PREFIXES, ...(t.numberingPrefixes as Record<string, string>) };
  return { prefixes, locked: used.map((u) => u.series), series: SERIES };
}

export async function updateNumbering(ctx: Ctx, input: z.infer<typeof numberingSchema>) {
  authorize(ctx, "tenant:settings");
  return ctx.db.$transaction(async (tx) => {
    const current = await getNumbering(tx, ctx.tenant.id);
    const next = { ...current.prefixes, ...input.prefixes };
    // NUM-03: a prefix is immutable once its series has issued a number.
    for (const series of current.locked)
      if (next[series as keyof typeof next] !== current.prefixes[series as keyof typeof current.prefixes])
        throw unprocessable("PREFIX_LOCKED", "This prefix is already in use and cannot change", `prefixes.${series}`);
    await tx.tenant.update({ where: { id: ctx.tenant.id }, data: { numberingPrefixes: next } });
    const changes = diff(current.prefixes, next);
    if (changes) await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "tenant.numbering_updated", entityType: "Tenant", entityId: ctx.tenant.id, changes });
    return { ...current, prefixes: next };
  });
}

/** NUM-01..03 formatted number, e.g. INV-2026-000042. Used by Phase 2+ documents. */
export async function nextDocumentNumber(tx: TenantTx, tenantId: string, series: (typeof SERIES)[number], date = new Date()) {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { numberingPrefixes: true } });
  const prefix = (t.numberingPrefixes as Record<string, string>)[series] ?? DEFAULT_PREFIXES[series];
  const year = date.getUTCFullYear();
  const value = await nextSequenceValue(tx, tenantId, series, year);
  return `${prefix}-${year}-${String(value).padStart(6, "0")}`;
}

// ───────── Sales & finance settings (§10.4, FIN-08, REF-01) ─────────

const FINANCE_FIELDS = ["discountApprovalPercent", "expenseApprovalLimit", "refundSelfApproval", "quotationValidityDays", "quotationTermsEn", "quotationTermsAr"] as const;

export async function getFinanceSettings(ctx: Pick<Ctx, "db" | "tenant">) {
  const t = await ctx.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: Object.fromEntries(FINANCE_FIELDS.map((f) => [f, true])) as Record<(typeof FINANCE_FIELDS)[number], true> });
  return { ...t, discountApprovalPercent: t.discountApprovalPercent.toString(), expenseApprovalLimit: t.expenseApprovalLimit.toString() };
}

export async function updateFinanceSettings(ctx: Ctx, input: z.infer<typeof financeSettingsSchema>) {
  authorize(ctx, "tenant:settings");
  await ctx.db.$transaction(async (tx) => {
    const before = await getFinanceSettings({ db: tx as unknown as Ctx["db"], tenant: ctx.tenant });
    const data = { ...input, quotationTermsEn: input.quotationTermsEn ?? null, quotationTermsAr: input.quotationTermsAr ?? null };
    await tx.tenant.update({ where: { id: ctx.tenant.id }, data });
    const changes = diff(before, data);
    if (changes) await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "tenant.finance_settings_updated", entityType: "Tenant", entityId: ctx.tenant.id, changes });
  });
  return getFinanceSettings(ctx);
}
