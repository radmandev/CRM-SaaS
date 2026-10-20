import { z } from "zod";
import { country, currency, email, phone } from "./schemas";
import { IATA_AIRLINE_RE, IATA_AIRPORT_RE, TICKET_RE, validDocumentNumber, validIban, type DocType } from "./travel";

// Phase 2 shared schemas (CRM §6, suppliers §9, catalog §7, bookings §8). Messages are i18n keys ("v.*").

const str = (max: number) => z.string().trim().max(max);
const req = (max: number) => str(max).min(1, "v.required");
const opt = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable()).optional();
const date = z.iso.date("v.date");
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "v.datetime");
const uuid = z.uuid("v.invalid");
/** Money as a decimal string (FIN-02), max 4 decimals. */
export const money = z.preprocess((v) => (v === "" || v == null ? "0" : String(v).trim()), z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, "v.money"));
const intIn = (min: number, max: number) => z.coerce.number().int("v.integer").min(min).max(max);
const bool = z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean());
const latinName = z.string().trim().min(1, "v.required").max(60).regex(/^[A-Za-z][A-Za-z '-]*$/, "v.latinName");
const version = z.coerce.number().int().min(1);

export const DOC_TYPES = ["PASSPORT", "NATIONAL_ID", "IQAMA", "VISA", "OTHER"] as const;
export const SERVICE_TYPES = ["FLIGHT", "HOTEL", "TRANSFER", "TOUR", "PACKAGE", "VISA", "INSURANCE", "OTHER"] as const;
export const SUPPLIER_TYPES = ["AIRLINE", "CONSOLIDATOR", "HOTEL", "HOTEL_WHOLESALER", "DMC", "TRANSFER", "TOUR_OPERATOR", "VISA_SERVICE", "INSURANCE", "OTHER"] as const;
export const ITEM_STATUSES = ["REQUESTED", "ON_REQUEST", "HELD", "CONFIRMED", "ISSUED", "CANCELLED", "FAILED"] as const;
export const TITLES = ["MR", "MRS", "MS", "MSTR", "MISS"] as const;
export const CHANNELS = ["CALL", "EMAIL", "WHATSAPP", "SMS", "MEETING", "NOTE", "OTHER"] as const;

// ───────── CRM ─────────

export const customerSchema = z
  .object({
    type: z.enum(["INDIVIDUAL", "CORPORATE"]),
    code: opt(z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, "v.code")),
    displayName: opt(str(200)),
    nameAr: opt(str(200)),
    firstName: opt(str(80)),
    lastName: opt(str(80)),
    lifecycleStage: z.enum(["LEAD", "ACTIVE", "INACTIVE"]).default("ACTIVE"),
    source: opt(z.enum(["WALK_IN", "PHONE", "WEBSITE", "REFERRAL", "SOCIAL", "CORPORATE", "OTHER"])),
    ownerId: opt(uuid),
    branchId: opt(uuid),
    phone: opt(phone),
    email: opt(email),
    gender: opt(z.enum(["M", "F"])),
    dateOfBirth: opt(date),
    nationality: opt(country),
    vatNumber: opt(z.string().trim().regex(/^\d{15}$/, "v.vatNumber")),
    crNumber: opt(str(20)),
    address: opt(str(500)),
    creditLimit: opt(money),
    paymentTermsDays: intIn(0, 365).default(0),
    preferredLocale: z.enum(["ar", "en"]).default("ar"),
    marketingConsent: bool.default(false),
    notes: opt(str(5000)),
    // Forms send "vip, family"; the API also accepts an array.
    tags: z.preprocess(
      (v) => (typeof v === "string" ? v.split(/[,،]/).map((x) => x.trim()).filter(Boolean) : v),
      z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    ),
    confirmDuplicate: bool.optional(),
  })
  .superRefine((c, ctx) => {
    if (c.type === "INDIVIDUAL" && !c.firstName) ctx.addIssue({ code: "custom", path: ["firstName"], message: "v.required" });
    if (c.type === "INDIVIDUAL" && !c.lastName) ctx.addIssue({ code: "custom", path: ["lastName"], message: "v.required" });
    if (c.type === "CORPORATE" && !c.displayName) ctx.addIssue({ code: "custom", path: ["displayName"], message: "v.required" });
  });
export const customerUpdateSchema = customerSchema.and(z.object({ version }));

export const contactSchema = z.object({
  name: req(120),
  title: opt(str(100)),
  phone: opt(phone),
  email: opt(email),
  isPrimary: bool.default(false),
  receivesInvoices: bool.default(false),
});

export const travelerSchema = z.object({
  title: opt(z.enum(TITLES)),
  firstName: latinName,
  middleName: opt(latinName),
  lastName: latinName,
  nameAr: opt(str(120)),
  gender: opt(z.enum(["M", "F"])),
  dateOfBirth: opt(date),
  nationality: opt(country),
  phone: opt(phone),
  email: opt(email),
  frequentFlyer: z.array(z.object({ airline: z.string().trim().toUpperCase().regex(IATA_AIRLINE_RE, "v.airline"), number: req(30) })).max(10).default([]),
  preferences: z.object({ meal: opt(str(40)), seat: opt(str(40)), assistance: opt(str(300)) }).default({}),
});

export const travelDocumentSchema = z
  .object({
    type: z.enum(DOC_TYPES),
    number: z.string().trim().toUpperCase().min(1, "v.required").max(30),
    issuingCountry: opt(country),
    nationality: opt(country),
    issueDate: opt(date),
    expiryDate: opt(date),
    holderName: opt(str(120)),
  })
  .superRefine((d, ctx) => {
    if (!validDocumentNumber(d.type as DocType, d.number)) ctx.addIssue({ code: "custom", path: ["number"], message: `v.doc.${d.type}` });
    if (d.issueDate && d.expiryDate && d.expiryDate <= d.issueDate) ctx.addIssue({ code: "custom", path: ["expiryDate"], message: "v.expiryAfterIssue" });
    if (d.type === "PASSPORT" && !d.expiryDate) ctx.addIssue({ code: "custom", path: ["expiryDate"], message: "v.required" });
  });

export const interactionSchema = z.object({
  channel: z.enum(CHANNELS),
  direction: z.enum(["IN", "OUT"]),
  subject: opt(str(200)),
  body: z.string().trim().min(1, "v.required").max(10_000), // CRM-11: plain text
  occurredAt: z.iso.datetime({ offset: true, local: true, message: "v.datetime" }),
  bookingId: opt(uuid),
});

export const mergeSchema = z.object({ intoCustomerId: uuid });

// ───────── Suppliers ─────────

export const supplierSchema = z.object({
  type: z.enum(SUPPLIER_TYPES),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, "v.code"),
  nameEn: req(200),
  nameAr: opt(str(200)),
  country: opt(country),
  city: opt(str(100)),
  address: opt(str(500)),
  phone: opt(phone),
  email: opt(email),
  website: opt(z.url("v.url").max(200)),
  vatNumber: opt(str(20)),
  crNumber: opt(str(20)),
  defaultCurrency: currency.default("SAR"),
  paymentTermsDays: intIn(0, 365).default(0),
  prepaid: bool.default(false),
  iban: opt(z.string().trim().toUpperCase().refine(validIban, "v.iban")),
  iataCode: opt(z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,3}$/, "v.code")),
  notes: opt(str(5000)),
});

export const supplierContactSchema = z.object({
  name: req(120),
  role: opt(z.enum(["RESERVATIONS", "ACCOUNTS", "SALES", "EMERGENCY", "OTHER"])),
  phone: opt(phone),
  email: opt(email),
  isPrimary: bool.default(false),
});

export const commissionRuleSchema = z
  .object({
    serviceType: opt(z.enum(SERVICE_TYPES)),
    productId: opt(uuid),
    kind: z.enum(["PERCENT", "FIXED"]),
    ratePercent: opt(z.string().trim().regex(/^\d{1,3}(\.\d{1,4})?$/, "v.percent")),
    fixedAmount: opt(money),
    currency: opt(currency),
    validFrom: opt(date),
    validTo: opt(date),
    notes: opt(str(500)),
  })
  .superRefine((r, ctx) => {
    if (r.kind === "PERCENT" && (!r.ratePercent || Number(r.ratePercent) > 100)) ctx.addIssue({ code: "custom", path: ["ratePercent"], message: "v.percent" });
    if (r.kind === "FIXED" && !r.fixedAmount) ctx.addIssue({ code: "custom", path: ["fixedAmount"], message: "v.required" });
    if (r.kind === "FIXED" && !r.currency) ctx.addIssue({ code: "custom", path: ["currency"], message: "v.required" });
    if (r.validFrom && r.validTo && r.validTo < r.validFrom) ctx.addIssue({ code: "custom", path: ["validTo"], message: "v.endAfterStart" });
  });

// ───────── Catalog ─────────

export const productSchema = z.object({
  type: z.enum(SERVICE_TYPES),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, "v.code"),
  nameEn: req(200),
  nameAr: opt(str(200)),
  descriptionEn: opt(str(2000)),
  descriptionAr: opt(str(2000)),
  defaultSupplierId: opt(uuid),
  defaultCost: money,
  defaultSell: money,
  currency: currency.default("SAR"),
  taxRateId: opt(uuid),
  pricingModel: z.enum(["NET", "COMMISSIONABLE"]).default("NET"),
  validFrom: opt(date),
  validTo: opt(date),
  active: bool.default(true),
  // Forms send checked component ids; the API also accepts [{ productId, quantity }].
  components: z.preprocess(
    (v) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? { productId: x, quantity: 1 } : x)) : v),
    z.array(z.object({ productId: uuid, quantity: intIn(1, 99).default(1) })).max(30).default([]),
  ),
});

// ───────── Booking item details (SVC-01, versioned by detailsVersion) ─────────

const airport = z.string().trim().toUpperCase().regex(IATA_AIRPORT_RE, "v.airport");
const segment = z
  .object({
    carrier: z.string().trim().toUpperCase().regex(IATA_AIRLINE_RE, "v.airline"),
    flightNumber: z.string().trim().toUpperCase().regex(/^\d{1,4}[A-Z]?$/, "v.flightNumber"),
    operatingCarrier: opt(z.string().trim().toUpperCase().regex(IATA_AIRLINE_RE, "v.airline")),
    origin: airport,
    destination: airport,
    departureLocal: localDateTime,
    arrivalLocal: localDateTime,
    cabin: z.enum(["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"]).default("ECONOMY"),
    bookingClass: opt(z.string().trim().toUpperCase().regex(/^[A-Z]$/, "v.bookingClass")),
    fareBasis: opt(str(15)),
    baggage: opt(str(40)),
    terminal: opt(str(10)),
  })
  .refine((s) => s.origin !== s.destination, { path: ["destination"], message: "v.sameAirport" });

export const detailsSchemas = {
  FLIGHT: z.object({
    tripType: z.enum(["ONE_WAY", "RETURN", "MULTI_CITY"]).default("ONE_WAY"),
    segments: z.array(segment).min(1, "v.segmentRequired").max(16),
    fare: z.object({ base: money, taxes: money, yqyr: money }).partial().optional(),
  }),
  HOTEL: z
    .object({
      hotelName: req(200),
      city: req(100),
      country: opt(country),
      address: opt(str(300)),
      starRating: opt(intIn(1, 5)),
      checkIn: date,
      checkOut: date,
      rooms: z
        .array(
          z.object({
            roomType: req(100),
            board: z.enum(["RO", "BB", "HB", "FB", "AI"]).default("BB"),
            adults: intIn(1, 10).default(2),
            childrenAges: z.array(intIn(0, 17)).max(6).default([]),
          }),
        )
        .min(1, "v.roomRequired")
        .max(20),
      cancellationPolicy: opt(str(2000)),
      cancellationDeadline: opt(date),
      specialRequests: opt(str(1000)),
    })
    .refine((h) => h.checkOut > h.checkIn, { path: ["checkOut"], message: "v.endAfterStart" }),
  TRANSFER: z.object({
    pickupLocation: req(200),
    dropoffLocation: req(200),
    pickupAt: localDateTime,
    vehicleType: opt(str(60)),
    passengers: intIn(1, 60).default(1),
    flightReference: opt(str(20)),
    private: bool.default(true),
  }),
  TOUR: z.object({
    name: req(200),
    date,
    startTime: opt(z.string().regex(/^\d{2}:\d{2}$/, "v.time")),
    durationHours: opt(z.coerce.number().min(0.5).max(240)),
    meetingPoint: opt(str(300)),
    language: opt(str(40)),
    inclusions: opt(str(2000)),
  }),
  PACKAGE: z.object({ name: req(200), destinations: opt(str(300)), inclusions: opt(str(4000)) }),
  VISA: z.object({
    destinationCountry: country,
    visaType: z.enum(["TOURIST", "BUSINESS", "TRANSIT", "UMRAH", "OTHER"]),
    entries: z.enum(["SINGLE", "MULTIPLE"]).default("SINGLE"),
    validityDays: opt(intIn(1, 3650)),
    processingDays: opt(intIn(0, 365)),
    applicationStatus: z.enum(["NOT_STARTED", "DOCUMENTS_PENDING", "SUBMITTED", "APPROVED", "REJECTED"]).default("NOT_STARTED"),
    applicationReference: opt(str(60)),
    visaNumber: opt(str(60)),
  }),
  INSURANCE: z.object({ insurer: opt(str(120)), policyNumber: opt(str(60)), coverage: opt(str(1000)) }),
  OTHER: z.object({ notes: opt(str(2000)) }),
} as const;
export const DETAILS_VERSION = 1;

const itemCommon = {
  description: opt(str(300)),
  supplierId: opt(uuid),
  productId: opt(uuid),
  startDate: opt(date),
  endDate: opt(date),
  quantity: intIn(1, 999).default(1),
  costAmount: money,
  sellAmount: money,
  commissionAmount: money,
  serviceFeeAmount: money,
  discountAmount: money,
  taxRateId: opt(uuid),
  taxBasis: z.enum(["FULL_AMOUNT", "SERVICE_FEE_ONLY"]).default("FULL_AMOUNT"),
  pricingModel: z.enum(["NET", "COMMISSIONABLE"]).default("NET"),
  supplierConfirmation: opt(str(60)),
  pnr: opt(z.string().trim().toUpperCase().regex(/^[A-Z0-9]{5,8}$/, "v.pnr")),
};

const itemObject = z.object({ ...itemCommon, serviceType: z.enum(SERVICE_TYPES), details: z.record(z.string(), z.unknown()).default({}) });

/** Validates `details` against the schema of its service type and returns the parsed (normalized) details. */
function withDetails<T extends { serviceType: (typeof SERVICE_TYPES)[number]; details: unknown }>(v: T, ctx: z.RefinementCtx) {
  const parsed = detailsSchemas[v.serviceType].safeParse(v.details);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ["details", ...issue.path] } as z.core.$ZodRawIssue);
    return z.NEVER;
  }
  return { ...v, details: parsed.data as Record<string, unknown> };
}

export const bookingItemSchema = itemObject.transform(withDetails);
export type BookingItemInput = z.infer<typeof bookingItemSchema>;

/** In change sets an empty form field means "leave unchanged", so it is dropped before validation. */
const stripEmpty = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && x !== undefined)) : v);

// Zod 4 applies .default() even inside .partial(), so change sets use the same fields without defaults;
// otherwise changing one price would silently reset quantity, tax basis and pricing model.
const { quantity: _q, taxBasis: _tb, pricingModel: _pm, ...commonWithoutDefaults } = itemCommon;

/** Fields an item update may change (draft bookings directly, confirmed bookings via amendments). */
export const itemChangesSchema = z.preprocess(
  stripEmpty,
  z
    .object({
      ...commonWithoutDefaults,
      quantity: intIn(1, 999),
      taxBasis: z.enum(["FULL_AMOUNT", "SERVICE_FEE_ONLY"]),
      pricingModel: z.enum(["NET", "COMMISSIONABLE"]),
      details: z.record(z.string(), z.unknown()),
    })
    .partial()
    .refine((c) => Object.keys(c).length > 0, "v.noChanges"),
);

// ───────── Bookings ─────────

export const bookingCreateSchema = z.object({
  customerId: uuid,
  branchId: opt(uuid),
  currency: opt(currency),
  notes: opt(str(5000)),
  customerNotes: opt(str(5000)),
  confirmDuplicate: bool.optional(),
});

export const bookingUpdateSchema = z.object({
  version,
  branchId: opt(uuid),
  destinationSummary: opt(str(200)),
  notes: opt(str(5000)),
  customerNotes: opt(str(5000)),
});

export const versionSchema = z.object({ version });
export const cancelBookingSchema = z.object({ version, reason: req(500) });

export const itemStatusSchema = z.object({
  status: z.enum(ITEM_STATUSES).exclude(["CANCELLED"]), // cancellation has its own endpoint (BKG-14)
  reason: opt(str(500)),
  supplierConfirmation: opt(str(60)),
  pnr: opt(z.string().trim().toUpperCase().regex(/^[A-Z0-9]{5,8}$/, "v.pnr")),
  optionDeadline: opt(z.iso.datetime({ offset: true, local: true, message: "v.datetime" })),
  // Forms send one row per passenger; rows left empty are ignored.
  tickets: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((t) => t && typeof t === "object" && String((t as { ticketNumber?: unknown }).ticketNumber ?? "").trim() !== "") : v),
    z.array(z.object({ passengerId: uuid, ticketNumber: z.string().trim().regex(TICKET_RE, "v.ticket") })).max(99).default([]),
  ),
});

export const cancelItemSchema = z.object({
  reason: req(500),
  supplierFee: money,
  agencyFee: money,
  expectedSupplierRefund: money,
});

export const passengerSchema = z
  .object({
    travelerId: opt(uuid),
    title: opt(z.enum(TITLES)),
    firstName: opt(latinName),
    middleName: opt(latinName),
    lastName: opt(latinName),
    gender: opt(z.enum(["M", "F"])),
    dateOfBirth: opt(date),
    nationality: opt(country),
    docType: opt(z.enum(DOC_TYPES)),
    docNumber: opt(z.string().trim().toUpperCase().max(30)),
    docExpiry: opt(date),
    isLead: bool.default(false),
    infantOfPassengerId: opt(uuid),
  })
  .superRefine((p, ctx) => {
    if (!p.travelerId && !p.firstName) ctx.addIssue({ code: "custom", path: ["firstName"], message: "v.required" });
    if (!p.travelerId && !p.lastName) ctx.addIssue({ code: "custom", path: ["lastName"], message: "v.required" });
    if (p.docNumber && !p.docType) ctx.addIssue({ code: "custom", path: ["docType"], message: "v.required" });
    if (p.docNumber && p.docType && !validDocumentNumber(p.docType as DocType, p.docNumber)) ctx.addIssue({ code: "custom", path: ["docNumber"], message: `v.doc.${p.docType}` });
  });

export const itemPassengersSchema = z.object({ passengerIds: z.array(uuid).max(99) });

const passengerChanges = z.preprocess(stripEmpty, z
  .object({
    firstName: latinName,
    middleName: latinName.nullable(),
    lastName: latinName,
    title: z.enum(TITLES).nullable(),
    dateOfBirth: date.nullable(),
    docExpiry: date.nullable(),
  })
  .partial());

export const amendmentSchema = z.object({
  reason: req(500),
  supplierFee: money,
  agencyFee: money,
  operations: z
    .array(
      z.discriminatedUnion("op", [
        z.object({ op: z.literal("updateItem"), itemId: uuid, changes: itemChangesSchema }),
        z.object({ op: z.literal("addItem"), item: bookingItemSchema }),
        z.object({ op: z.literal("updatePassenger"), passengerId: uuid, changes: passengerChanges }),
      ]),
    )
    .min(1, "v.noChanges")
    .max(30),
});

export const itineraryNoteSchema = z
  .object({ date, textEn: opt(str(2000)), textAr: opt(str(2000)) })
  .refine((n) => n.textEn || n.textAr, { path: ["textEn"], message: "v.required" });

export const bookingListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(["DRAFT", "ON_HOLD", "CONFIRMED", "ISSUED", "COMPLETED", "CANCELLED"]).optional(),
  travelFrom: date.optional(),
  travelTo: date.optional(),
  customerId: uuid.optional(),
});

export const customerListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
  q: z.string().trim().max(100).optional(),
  stage: z.enum(["LEAD", "ACTIVE", "INACTIVE"]).optional(),
  type: z.enum(["INDIVIDUAL", "CORPORATE"]).optional(),
  archived: z.enum(["true", "false"]).optional(),
});
