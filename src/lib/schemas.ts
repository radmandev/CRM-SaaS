import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import commonPasswords from "./common-passwords.json";

// Shared by forms (client-side validation) and route handlers (authoritative validation). FR-05, API-11.
// Custom messages are i18n keys ("v.*").

const common = new Set<string>(commonPasswords);

/** Trimmed string with a max length (API-13). */
const str = (max: number) => z.string().trim().max(max);
const req = (max: number) => str(max).min(1, "v.required");
/** Optional text: empty string becomes null so forms can clear a field. */
const opt = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable()).optional();

export const ROLES = ["OWNER", "ADMIN", "BRANCH_MANAGER", "SALES_AGENT", "OPERATIONS_AGENT", "ACCOUNTANT", "VIEWER"] as const;
export const SERIES = ["BOOKING", "QUOTATION", "INVOICE", "CREDIT_NOTE", "RECEIPT", "REFUND", "SUPPLIER_PAYMENT", "EXPENSE"] as const;
export const DEFAULT_PREFIXES: Record<(typeof SERIES)[number], string> = {
  BOOKING: "BK", QUOTATION: "QT", INVOICE: "INV", CREDIT_NOTE: "CN", RECEIPT: "RCP", REFUND: "RF", SUPPLIER_PAYMENT: "SP", EXPENSE: "EXP",
};

export const email = z.string().trim().toLowerCase().max(254).pipe(z.email("v.email"));
export const password = z
  .string()
  .min(12, "v.passwordLength")
  .max(128, "v.passwordLength")
  .refine((p) => !common.has(p.toLowerCase()), "v.passwordCommon"); // AUTH-03
export const uuid = z.uuid("v.invalid");
export const locale = z.enum(["ar", "en"]);

export const phone = z
  .string()
  .trim()
  .max(32)
  .transform((v, ctx) => {
    const parsed = parsePhoneNumberFromString(v, "SA"); // LOC-07
    if (!parsed?.isValid()) {
      ctx.addIssue({ code: "custom", message: "v.phone" });
      return z.NEVER;
    }
    return parsed.number;
  });

const timezones = new Set(Intl.supportedValuesOf("timeZone").concat("UTC"));
const currencies = new Set(Intl.supportedValuesOf("currency"));
export const timezone = z.string().refine((tz) => timezones.has(tz), "v.timezone");
export const currency = z.string().trim().toUpperCase().refine((c) => currencies.has(c), "v.currency");
export const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "v.country");

/** WCAG AA: white text on this color must reach 4.5:1 (§5.3). */
export function contrastWithWhite(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05);
}
export const brandColor = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, "v.color")
  .refine((c) => contrastWithWhite(c) >= 4.5, "v.colorContrast");

// ───────── Auth / onboarding ─────────

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "v.slug"); // ONB-02

export const signupSchema = z.object({
  name: req(120),
  email,
  password,
  agencyName: req(200),
  slug,
  country: country.default("SA"),
  locale: locale.default("ar"),
});

export const loginSchema = z.object({ email, password: z.string().min(1, "v.required").max(128) });
export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token: z.string().min(1).max(512), newPassword: password });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1, "v.required").max(128), newPassword: password });

export const profileSchema = z.object({ name: req(120), locale });
export const activeTenantSchema = z.object({ tenantId: uuid });
export const localeSchema = z.object({ locale });

// ───────── Agency settings (§5) ─────────

const vatNumber = z.string().trim().regex(/^\d{15}$/, "v.vatNumber");

export const agencySchema = z
  .object({
    legalNameEn: req(200),
    legalNameAr: opt(str(200)),
    tradeNameEn: opt(str(200)),
    tradeNameAr: opt(str(200)),
    country,
    crNumber: opt(str(20)),
    vatRegistered: z.boolean(),
    vatNumber: opt(vatNumber),
    vatRegisteredAt: opt(z.iso.date("v.date")),
    tourismLicenseNumber: opt(str(50)),
    addressBuilding: opt(str(10)),
    addressStreet: opt(str(200)),
    addressDistrict: opt(str(100)),
    addressCity: opt(str(100)),
    addressPostalCode: opt(str(10)),
    addressAdditionalNumber: opt(str(10)),
    phone: opt(phone),
    email: opt(email),
    website: opt(z.url("v.url").max(200)),
    baseCurrency: currency,
    enabledCurrencies: z.array(currency).min(1).max(50),
    timezone,
    defaultLocale: locale,
    weekStartsOn: z.coerce.number().int().min(0).max(6),
    showHijri: z.boolean(),
    pricesIncludeTax: z.boolean(),
    primaryColor: brandColor,
    documentFooterEn: opt(str(500)),
    documentFooterAr: opt(str(500)),
  })
  .superRefine((a, ctx) => {
    const sa = a.country === "SA";
    if (a.vatRegistered && !a.vatNumber) ctx.addIssue({ code: "custom", path: ["vatNumber"], message: "v.required" });
    // KSA-08: 15 digits, first and last digit 3.
    if (sa && a.vatNumber && !/^3\d{13}3$/.test(a.vatNumber)) ctx.addIssue({ code: "custom", path: ["vatNumber"], message: "v.vatNumberSa" });
    if (sa && a.crNumber && !/^\d{10}$/.test(a.crNumber)) ctx.addIssue({ code: "custom", path: ["crNumber"], message: "v.crNumber" });
    if (sa && a.addressPostalCode && !/^\d{5}$/.test(a.addressPostalCode)) ctx.addIssue({ code: "custom", path: ["addressPostalCode"], message: "v.postalCode" });
    if (sa && a.addressBuilding && !/^\d{4}$/.test(a.addressBuilding)) ctx.addIssue({ code: "custom", path: ["addressBuilding"], message: "v.digits4" });
    if (sa && a.addressAdditionalNumber && !/^\d{4}$/.test(a.addressAdditionalNumber)) ctx.addIssue({ code: "custom", path: ["addressAdditionalNumber"], message: "v.digits4" });
    if (!a.enabledCurrencies.includes(a.baseCurrency)) ctx.addIssue({ code: "custom", path: ["enabledCurrencies"], message: "v.baseCurrencyEnabled" });
  });

export const branchSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, "v.branchCode"),
  nameEn: req(120),
  nameAr: opt(str(120)),
  address: opt(str(300)),
  phone: opt(phone),
  email: opt(email),
  timezone: opt(timezone),
});

export const taxRateSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{1,20}$/, "v.code"),
  nameEn: req(100),
  nameAr: req(100),
  rate: z.string().trim().regex(/^\d{1,3}(\.\d{1,4})?$/, "v.percent").refine((r) => Number(r) <= 100, "v.percent"),
  category: z.enum(["STANDARD", "ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"]),
  exemptionReasonCode: opt(str(50)),
  exemptionReasonText: opt(str(300)),
  active: z.boolean(),
});

export const exchangeRateSchema = z
  .object({
    fromCurrency: currency,
    toCurrency: currency,
    rate: z.string().trim().regex(/^\d{1,10}(\.\d{1,10})?$/, "v.rate").refine((r) => Number(r) > 0, "v.rate"),
    effectiveDate: z.iso.date("v.date"),
  })
  .refine((r) => r.fromCurrency !== r.toCurrency, { path: ["toCurrency"], message: "v.sameCurrency" });

export const numberingSchema = z.object({
  prefixes: z.partialRecord(z.enum(SERIES), z.string().trim().toUpperCase().regex(/^[A-Z]{1,6}$/, "v.prefix")),
});

// ───────── Users & invitations (§4.4) ─────────

export const invitationSchema = z.object({
  email,
  role: z.enum(ROLES),
  branchIds: z.array(uuid).min(1, "v.branchRequired").max(50),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(1).max(512),
  // Required only when the invited email has no account yet.
  name: opt(req(120)),
  password: password.optional(),
  locale: locale.optional(),
});

export const memberUpdateSchema = z.object({
  role: z.enum(ROLES).optional(),
  branchIds: z.array(uuid).min(1, "v.branchRequired").max(50).optional(),
  primaryBranchId: uuid.optional(),
  jobTitle: opt(str(100)),
  phone: opt(phone),
  employeeCode: opt(str(30)),
  status: z.enum(["ACTIVE", "DEACTIVATED"]).optional(),
});

// ───────── Lists (API-05..07) ─────────

export const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
  q: z.string().trim().max(100).optional(),
});

/** Schemas the browser form component can look up by name (client-side validation, FR-05). */
export const formSchemas = {
  signup: signupSchema,
  login: loginSchema,
  forgotPassword: forgotPasswordSchema,
  resetPassword: resetPasswordSchema,
  changePassword: changePasswordSchema,
  profile: profileSchema,
  agency: agencySchema,
  branch: branchSchema,
  taxRate: taxRateSchema,
  exchangeRate: exchangeRateSchema,
  numbering: numberingSchema,
  invitation: invitationSchema,
  acceptInvitation: acceptInvitationSchema,
  memberUpdate: memberUpdateSchema,
} as const;
export type FormSchemaName = keyof typeof formSchemas;
