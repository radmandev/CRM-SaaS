import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { BookingItemStatus, BookingStatus } from "@/generated/prisma/enums";
import { prisma, tenantDb, type TenantTx } from "@/server/db";
import { audit, diff, type Actor } from "@/server/audit";
import { authorize, can, type Ctx } from "@/server/context";
import { env } from "@/server/env";
import { AppError, conflict, forbidden, notFound, unprocessable } from "@/server/errors";
import { after, page } from "@/server/pagination";
import { assertBranchAllowed, assertWritable, inScope, scopeWhere } from "@/server/scope";
import { decrypt, encrypt, last4, lookupHash, mask, normalizeId } from "@/server/crypto";
import { D, str } from "@/server/money";
import { lockBooking } from "@/server/db/raw/bookings";
import { createLink, verifyLink } from "@/server/signed-links";
import { nextDocumentNumber } from "@/modules/tenancy/service";
import { suggestCommission } from "@/modules/suppliers/service";
import { paxType } from "@/lib/travel";
import { rateToBase } from "@/modules/finance/common";
import {
  bookingItemSchema, DETAILS_VERSION, type amendmentSchema, type bookingCreateSchema, type BookingItemInput, type bookingListQuery,
  type bookingUpdateSchema, type cancelItemSchema, type itemChangesSchema, type itemStatusSchema, type itineraryNoteSchema, type passengerSchema,
} from "@/lib/schemas-travel";
import { buildItinerary, canTransition, deriveStatus, describe, isActive, isClosed, isDirectlyEditable, itemDates, itemTax, needsApproval, totals } from "./rules";

const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const today = () => new Date().toISOString().slice(0, 10);

// ───────── Loading and guards ─────────

async function loadBooking(ctx: Ctx, id: string) {
  const b = await ctx.db.booking.findFirst({ where: { id, ...scopeWhere(ctx, "booking:read") } });
  if (!b) throw notFound();
  return b;
}

/** Visible + writable + not closed. Locks the row so concurrent item edits serialize (totals stay consistent). */
async function writableBooking(ctx: Ctx, tx: TenantTx, id: string, opts: { direct?: boolean } = {}) {
  const b = await tx.booking.findFirst({ where: { id, ...scopeWhere(ctx, "booking:read") } });
  if (!b) throw notFound();
  assertWritable(ctx, "booking:write", b);
  await lockBooking(tx, ctx.tenant.id, id);
  const fresh = await tx.booking.findUniqueOrThrow({ where: { id } });
  if (isClosed(fresh.status)) throw conflict("BOOKING_CLOSED", "This booking is cancelled or completed");
  // BKG-18/20: once confirmed, items, prices and passengers change only through an amendment.
  if (opts.direct && !isDirectlyEditable(fresh.status)) throw conflict("AMENDMENT_REQUIRED", "Confirmed bookings change through an amendment");
  return fresh;
}

function checkVersion(b: { version: number }, version: number) {
  if (b.version !== version) throw new AppError(409, "VERSION_CONFLICT", "This booking was changed by someone else. Reload and try again.", [], {}, { currentVersion: b.version });
}

async function history(tx: TenantTx, tenantId: string, bookingId: string, from: string | null, to: string, actor: Actor, reason?: string | null, bookingItemId?: string) {
  await tx.bookingStatusHistory.create({ data: { tenantId, bookingId, bookingItemId: bookingItemId ?? null, fromStatus: from, toStatus: to, reason: reason ?? null, userId: actor.id } });
}

/** Recompute totals, travel dates, destination summary and derived status; bump the version (BKG-04, BKG-21). */
export async function recalc(tx: TenantTx, tenantId: string, bookingId: string, actor: Actor) {
  const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { items: { include: { cancellation: true }, orderBy: { sortOrder: "asc" } }, amendments: { where: { status: "APPLIED" } } } });
  const t = totals({
    inclusive: b.pricesIncludeTax,
    currency: b.currency,
    items: b.items.map((i) => ({ ...i, cancellation: i.cancellation })),
    amendments: b.amendments,
  });
  const active = b.items.filter((i) => isActive(i.status));
  const dated = active.length ? active : b.items;
  const starts = dated.map((i) => isoDate(i.startDate)!).sort();
  const ends = dated.map((i) => isoDate(i.endDate)!).sort();
  const destinations = [
    ...new Set(
      active.flatMap((i) =>
        i.serviceType === "FLIGHT" ? [(i.details as { segments: { destination: string }[] }).segments.at(-1)!.destination] : i.serviceType === "HOTEL" ? [String((i.details as { city: string }).city)] : [],
      ),
    ),
  ].slice(0, 3);
  const status = deriveStatus(b.status, b.confirmedAt, b.items);
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { discountApprovalPercent: true } });
  await tx.booking.update({
    where: { id: bookingId },
    data: {
      ...t,
      requiresApproval: needsApproval(b.items, tenant.discountApprovalPercent), // QT-10
      balance: t.grandTotal.minus(b.paidTotal),
      travelStartDate: starts.length ? day(starts[0]) : null,
      travelEndDate: ends.length ? day(ends.at(-1)!) : null,
      destinationSummary: destinations.join(" · ") || null,
      status,
      version: { increment: 1 },
    },
  });
  if (status !== b.status) await history(tx, tenantId, bookingId, b.status, status, { type: "SYSTEM", id: actor.id }, "derived from item statuses");
  return status;
}

// ───────── Reads ─────────

export async function listBookings(ctx: Ctx, q: z.infer<typeof bookingListQuery>) {
  const term = q.q?.trim();
  const rows = await ctx.db.booking.findMany({
    where: {
      ...scopeWhere(ctx, "booking:read"),
      ...(q.status ? { status: q.status } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.travelFrom || q.travelTo ? { travelStartDate: { ...(q.travelFrom ? { gte: day(q.travelFrom) } : {}), ...(q.travelTo ? { lte: day(q.travelTo) } : {}) } } : {}),
      ...(term
        ? {
            OR: [
              { reference: { contains: term, mode: "insensitive" } },
              { customer: { displayName: { contains: term, mode: "insensitive" } } },
              { items: { some: { pnr: term.toUpperCase() } } },
              { passengers: { some: { lastName: { contains: term.toUpperCase() } } } },
            ],
          }
        : {}),
      ...after(q.cursor, "createdAt", "desc"),
    },
    select: { id: true, reference: true, status: true, travelStartDate: true, travelEndDate: true, destinationSummary: true, currency: true, grandTotal: true, createdAt: true, customer: { select: { id: true, displayName: true } }, branchId: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  const p = page(rows, q.limit, (r) => r.createdAt);
  return { ...p, data: p.data.map((b) => ({ ...b, travelStartDate: isoDate(b.travelStartDate), travelEndDate: isoDate(b.travelEndDate) })) };
}

function passengerView<T extends { docLast4: string | null; docNumberEnc: string | null; docNumberHash: string | null; dateOfBirth: Date | null; docExpiry: Date | null }>(p: T) {
  const { docNumberEnc: _e, docNumberHash: _h, dateOfBirth, docExpiry, ...rest } = p;
  return { ...rest, docNumber: mask(p.docLast4), dateOfBirth: isoDate(dateOfBirth), docExpiry: isoDate(docExpiry) };
}

export async function getBooking(ctx: Ctx, id: string) {
  const b = await ctx.db.booking.findFirst({
    where: { id, ...scopeWhere(ctx, "booking:read") },
    include: {
      customer: { select: { id: true, code: true, displayName: true, phone: true, email: true } },
      branch: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      owner: { select: { id: true, user: { select: { name: true } } } },
      items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { cancellation: true, passengers: true, supplier: { select: { id: true, nameEn: true, nameAr: true } } } },
      passengers: { orderBy: [{ isLead: "desc" }, { createdAt: "asc" }] },
      history: { orderBy: { createdAt: "desc" }, take: 100 },
      amendments: { orderBy: { number: "desc" } },
      itineraryNotes: { orderBy: { date: "asc" } },
    },
  });
  if (!b) throw notFound();
  const showDocs = can(ctx, "traveldoc:read");
  const showMargin = can(ctx, "report:financial") || b.ownerId === ctx.membership.id; // SVC-07
  const writable = can(ctx, "booking:write") && inScope(ctx, "booking:write", b) && !isClosed(b.status);
  return {
    ...b,
    travelStartDate: isoDate(b.travelStartDate),
    travelEndDate: isoDate(b.travelEndDate),
    costTotal: showMargin ? b.costTotal : null,
    commissionTotal: showMargin ? b.commissionTotal : null,
    items: b.items.map((i) => ({
      ...i,
      startDate: isoDate(i.startDate),
      endDate: isoDate(i.endDate),
      costAmount: showMargin ? i.costAmount : null,
      commissionAmount: showMargin ? i.commissionAmount : null,
      passengerIds: i.passengers.map((p) => p.bookingPassengerId),
      tickets: i.passengers.filter((p) => p.ticketNumber).map((p) => ({ passengerId: p.bookingPassengerId, ticketNumber: p.ticketNumber })),
    })),
    passengers: b.passengers.map((p) => ({ ...passengerView(p), docNumber: showDocs ? mask(p.docLast4) : null })),
    itineraryNotes: b.itineraryNotes.map((n) => ({ ...n, date: isoDate(n.date) })),
    permissions: {
      write: writable,
      direct: writable && isDirectlyEditable(b.status),
      amend: writable && !isDirectlyEditable(b.status),
      revealDocs: can(ctx, "traveldoc:reveal") && inScope(ctx, "traveldoc:reveal", b),
      margin: showMargin,
    },
  };
}

// ───────── Booking lifecycle ─────────

/** QT-10: any price change invalidates an earlier discount approval. */
async function resetApproval(tx: TenantTx, bookingId: string) {
  await tx.booking.updateMany({ where: { id: bookingId, approvedAt: { not: null } }, data: { approvedAt: null, approvedById: null } });
}

export async function approveBooking(ctx: Ctx, id: string) {
  return ctx.db.$transaction(async (tx) => {
    const b = await writableBooking(ctx, tx, id, { direct: true });
    if (!inScope(ctx, "quotation:approve-discount", b)) throw forbidden();
    if (!b.requiresApproval) throw unprocessable("APPROVAL_NOT_NEEDED", "This booking needs no approval");
    await tx.booking.update({ where: { id }, data: { approvedAt: new Date(), approvedById: ctx.user.id, version: { increment: 1 } } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking.discount_approved", entityType: "Booking", entityId: id, metadata: { grandTotal: b.grandTotal.toString(), costTotal: b.costTotal.toString() } });
    return { id };
  });
}

export async function createBooking(ctx: Ctx, input: z.infer<typeof bookingCreateSchema>) {
  authorize(ctx, "booking:write");
  const customer = await ctx.db.customer.findFirst({ where: { id: input.customerId, mergedIntoId: null, archivedAt: null, ...scopeWhere(ctx, "customer:read") } });
  if (!customer) throw unprocessable("INVALID_CUSTOMER", "Customer not found", "customerId");
  const branchId = input.branchId ?? ctx.membership.primaryBranchId;
  assertBranchAllowed(ctx, "booking:write", branchId);
  // BKG-23: soft duplicate warning — a draft for the same customer created in the last 24 hours.
  if (!input.confirmDuplicate) {
    const dupes = await ctx.db.booking.findMany({
      where: { customerId: customer.id, status: { in: ["DRAFT", "ON_HOLD"] }, createdAt: { gt: new Date(Date.now() - 86_400_000) }, ...scopeWhere(ctx, "booking:read") },
      select: { id: true, reference: true, createdAt: true },
      take: 5,
    });
    if (dupes.length) throw new AppError(409, "POSSIBLE_DUPLICATE", "A draft booking for this customer was created in the last 24 hours", [], {}, { duplicates: dupes });
  }
  return ctx.db.$transaction(async (tx) => {
    if (!(await tx.branch.count({ where: { id: branchId, archivedAt: null } }))) throw unprocessable("INVALID_BRANCH", "Branch not found", "branchId");
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { baseCurrency: true, enabledCurrencies: true, pricesIncludeTax: true } });
    const currency = input.currency ?? tenant.baseCurrency;
    if (!tenant.enabledCurrencies.includes(currency)) throw unprocessable("CURRENCY_NOT_ENABLED", "This currency is not enabled for the agency", "currency");
    const exchangeRate = await rateToBase(tx, currency, tenant.baseCurrency);
    const reference = await nextDocumentNumber(tx, ctx.tenant.id, "BOOKING"); // BKG-01: assigned at creation
    const b = await tx.booking.create({
      data: {
        tenantId: ctx.tenant.id, reference, customerId: customer.id, branchId, ownerId: ctx.membership.id, currency, exchangeRate,
        pricesIncludeTax: tenant.pricesIncludeTax, notes: input.notes ?? null, customerNotes: input.customerNotes ?? null, createdById: ctx.user.id,
      },
    });
    await history(tx, ctx.tenant.id, b.id, null, "DRAFT", ctx.actor);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking.created", entityType: "Booking", entityId: b.id, metadata: { reference, customerId: customer.id, currency } });
    return { id: b.id, reference: b.reference, status: b.status, version: b.version };
  });
}

export async function updateBooking(ctx: Ctx, id: string, input: z.infer<typeof bookingUpdateSchema>) {
  return ctx.db.$transaction(async (tx) => {
    const b = await writableBooking(ctx, tx, id);
    checkVersion(b, input.version);
    const branchId = input.branchId ?? b.branchId;
    if (branchId !== b.branchId) {
      assertBranchAllowed(ctx, "booking:write", branchId);
      if (!(await tx.branch.count({ where: { id: branchId, archivedAt: null } }))) throw unprocessable("INVALID_BRANCH", "Branch not found", "branchId");
    }
    const data = { branchId, notes: input.notes ?? null, customerNotes: input.customerNotes ?? null, ...(input.destinationSummary !== undefined ? { destinationSummary: input.destinationSummary } : {}) };
    const updated = await tx.booking.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
    const changes = diff(b, data);
    if (changes) await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking.updated", entityType: "Booking", entityId: id, changes });
    return { id, version: updated.version };
  });
}

/** §8.2 confirm: the customer confirmed and every active item is confirmed (or issued) with at least one passenger. */
export async function confirmBooking(ctx: Ctx, id: string, version: number) {
  return ctx.db.$transaction(async (tx) => {
    const b = await writableBooking(ctx, tx, id, { direct: true });
    checkVersion(b, version);
    const items = await tx.bookingItem.findMany({ where: { bookingId: id } });
    const active = items.filter((i) => isActive(i.status));
    if (!active.length) throw unprocessable("NO_ACTIVE_ITEMS", "Add at least one service first");
    if (active.some((i) => i.status !== "CONFIRMED" && i.status !== "ISSUED")) throw unprocessable("ITEMS_NOT_CONFIRMED", "Every service must be confirmed by its supplier first");
    if (!(await tx.bookingPassenger.count({ where: { bookingId: id } }))) throw unprocessable("NO_PASSENGERS", "Add the passengers first");
    if (b.requiresApproval && !b.approvedAt) throw unprocessable("APPROVAL_REQUIRED", "A manager must approve the discount or below-cost price first");
    await tx.booking.update({ where: { id }, data: { confirmedAt: new Date() } });
    const status = await recalc(tx, ctx.tenant.id, id, ctx.actor);
    await history(tx, ctx.tenant.id, id, b.status, status, ctx.actor, "customer confirmed");
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking.confirmed", entityType: "Booking", entityId: id, changes: { status: [b.status, status] } });
    return { id, status };
  });
}

/** Cancels every active item without fees; per-item fees go through item cancellation (BKG-14). */
export async function cancelBooking(ctx: Ctx, id: string, version: number, reason: string) {
  authorize(ctx, "booking:cancel");
  return ctx.db.$transaction(async (tx) => {
    const b = await writableBooking(ctx, tx, id);
    assertWritable(ctx, "booking:cancel", b);
    checkVersion(b, version);
    const items = await tx.bookingItem.findMany({ where: { bookingId: id, status: { notIn: ["CANCELLED"] } } });
    for (const i of items) {
      await tx.bookingItem.update({ where: { id: i.id }, data: { status: "CANCELLED" } });
      await tx.bookingItemCancellation.create({ data: { tenantId: ctx.tenant.id, bookingItemId: i.id, reason, cancelledById: ctx.user.id } });
      await history(tx, ctx.tenant.id, id, i.status, "CANCELLED", ctx.actor, reason, i.id);
    }
    await tx.booking.update({ where: { id }, data: { status: "CANCELLED" } });
    await recalc(tx, ctx.tenant.id, id, ctx.actor);
    await history(tx, ctx.tenant.id, id, b.status, "CANCELLED", ctx.actor, reason);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking.cancelled", entityType: "Booking", entityId: id, changes: { status: [b.status, "CANCELLED"] }, metadata: { reason, items: items.length } });
    // BKG-17: releasing held options at suppliers becomes a task once tasks exist (Phase 4).
    return { id, status: "CANCELLED" as BookingStatus, heldItems: items.filter((i) => i.status === "HELD").map((i) => i.id) };
  });
}

// ───────── Items (§7.1, §8.3) ─────────

export async function resolveItem(ctx: Ctx, tx: TenantTx, b: { id: string; currency: string; pricesIncludeTax: boolean }, input: BookingItemInput) {
  if (input.supplierId && !(await tx.supplier.count({ where: { id: input.supplierId, archivedAt: null } }))) throw unprocessable("INVALID_SUPPLIER", "Supplier not found", "supplierId");
  if (input.productId && !(await tx.product.count({ where: { id: input.productId, active: true } }))) throw unprocessable("INVALID_PRODUCT", "Product not found", "productId");
  if (input.serviceType === "FLIGHT") {
    const codes = [...new Set((input.details.segments as { origin: string; destination: string }[]).flatMap((s) => [s.origin, s.destination]))];
    const known = await prisma.airport.count({ where: { code: { in: codes } } }); // global reference table
    if (known !== codes.length) throw unprocessable("UNKNOWN_AIRPORT", "Unknown airport code", "details.segments");
  }
  const dates = itemDates(input.serviceType, input.details, input.startDate, input.endDate);
  if (!dates) throw unprocessable("DATE_REQUIRED", "Start date is required", "startDate");
  if (dates.endDate < dates.startDate) throw unprocessable("END_BEFORE_START", "End date is before start date", "endDate");
  const amounts = {
    sellAmount: D(input.sellAmount), serviceFeeAmount: D(input.serviceFeeAmount), discountAmount: D(input.discountAmount),
    costAmount: D(input.costAmount), commissionAmount: D(input.commissionAmount),
  };
  if (amounts.discountAmount.greaterThan(amounts.sellAmount.plus(amounts.serviceFeeAmount))) throw unprocessable("DISCOUNT_TOO_HIGH", "Discount exceeds the price", "discountAmount");
  // SUP-01: prefill commission from the most specific rule when the user left it at zero.
  if (amounts.commissionAmount.isZero() && input.supplierId) {
    const suggested = await suggestCommission(tx as unknown as Ctx["db"], input.supplierId, input.serviceType, input.productId ?? null, dates.startDate, amounts.sellAmount, b.currency);
    if (suggested) amounts.commissionAmount = suggested;
  }
  let snapshot: Prisma.InputJsonValue | null = null;
  let rate = null;
  if (input.taxRateId) {
    const tr = await tx.taxRate.findFirst({ where: { id: input.taxRateId, active: true } });
    if (!tr) throw unprocessable("INVALID_TAX_RATE", "Tax rate not found", "taxRateId");
    snapshot = { code: tr.code, rate: tr.rate.toString(), category: tr.category, zatcaCode: tr.zatcaCode, exemptionReasonCode: tr.exemptionReasonCode };
    rate = tr.rate;
  }
  const taxAmount = itemTax(amounts, input.taxBasis, rate, b.pricesIncludeTax, b.currency);
  return {
    serviceType: input.serviceType,
    productId: input.productId ?? null,
    supplierId: input.supplierId ?? null,
    description: input.description || describe(input.serviceType, input.details),
    startDate: day(dates.startDate),
    endDate: day(dates.endDate),
    quantity: input.quantity,
    ...Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, str(v)])),
    taxRateId: input.taxRateId ?? null,
    taxRateSnapshot: snapshot ?? undefined,
    taxBasis: input.taxBasis,
    taxAmount: str(taxAmount),
    pricingModel: input.pricingModel,
    supplierConfirmation: input.supplierConfirmation ?? null,
    pnr: input.pnr ?? null,
    details: input.details as Prisma.InputJsonValue,
    detailsVersion: DETAILS_VERSION,
  };
}

export async function addItem(ctx: Ctx, bookingId: string, input: BookingItemInput) {
  return ctx.db.$transaction(async (tx) => {
    const b = await writableBooking(ctx, tx, bookingId, { direct: true });
    const data = await resolveItem(ctx, tx, b, input);
    const sortOrder = await tx.bookingItem.count({ where: { bookingId } });
    const item = await tx.bookingItem.create({ data: { ...data, tenantId: ctx.tenant.id, bookingId, sortOrder } as Prisma.BookingItemUncheckedCreateInput });
    await history(tx, ctx.tenant.id, bookingId, null, "REQUESTED", ctx.actor, null, item.id);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking_item.created", entityType: "BookingItem", entityId: item.id, parentEntityType: "Booking", parentEntityId: bookingId, metadata: { serviceType: item.serviceType, sell: str(D(item.sellAmount)) } });
    await resetApproval(tx, bookingId);
    await recalc(tx, ctx.tenant.id, bookingId, ctx.actor);
    return { id: item.id, commissionAmount: item.commissionAmount.toString(), taxAmount: item.taxAmount.toString() };
  });
}

/** Merge changes over the stored item and re-validate the whole item, details included. */
function mergedItemInput(i: Prisma.BookingItemGetPayload<object>, changes: z.infer<typeof itemChangesSchema>): BookingItemInput {
  const merged = {
    serviceType: i.serviceType,
    description: i.description,
    supplierId: i.supplierId,
    productId: i.productId,
    startDate: isoDate(i.startDate),
    endDate: isoDate(i.endDate),
    quantity: i.quantity,
    costAmount: i.costAmount.toString(),
    sellAmount: i.sellAmount.toString(),
    commissionAmount: i.commissionAmount.toString(),
    serviceFeeAmount: i.serviceFeeAmount.toString(),
    discountAmount: i.discountAmount.toString(),
    taxRateId: i.taxRateId,
    taxBasis: i.taxBasis,
    pricingModel: i.pricingModel,
    supplierConfirmation: i.supplierConfirmation,
    pnr: i.pnr,
    details: i.details,
    ...changes,
  };
  // Dates of flights/hotels follow their details; stale explicit dates must not override them.
  if ((i.serviceType === "FLIGHT" || i.serviceType === "HOTEL") && changes.details) Object.assign(merged, { startDate: null, endDate: null });
  const parsed = bookingItemSchema.safeParse(merged);
  if (!parsed.success) throw new AppError(422, "VALIDATION_FAILED", "Validation failed", parsed.error.issues.map((x) => ({ path: x.path.join("."), code: x.code, message: x.message })));
  return parsed.data;
}

async function applyItemChanges(ctx: Ctx, tx: TenantTx, b: { id: string; currency: string; pricesIncludeTax: boolean }, itemId: string, changes: z.infer<typeof itemChangesSchema>) {
  const item = await tx.bookingItem.findFirst({ where: { id: itemId, bookingId: b.id } });
  if (!item) throw notFound();
  if (!isActive(item.status)) throw conflict("ITEM_INACTIVE", "Cancelled or failed services cannot be edited");
  const data = await resolveItem(ctx, tx, b, mergedItemInput(item, changes));
  await tx.bookingItem.update({ where: { id: itemId }, data: data as Prisma.BookingItemUncheckedUpdateInput });
  return diff({ ...item, startDate: item.startDate, endDate: item.endDate }, data as Record<string, unknown>);
}

export async function updateItem(ctx: Ctx, bookingId: string, itemId: string, changes: z.infer<typeof itemChangesSchema>) {
  return ctx.db.$transaction(async (tx) => {
    const b = await writableBooking(ctx, tx, bookingId, { direct: true });
    const changed = await applyItemChanges(ctx, tx, b, itemId, changes);
    if (changed) await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking_item.updated", entityType: "BookingItem", entityId: itemId, parentEntityType: "Booking", parentEntityId: bookingId, changes: changed });
    if (changed) await resetApproval(tx, bookingId);
    await recalc(tx, ctx.tenant.id, bookingId, ctx.actor);
    return { id: itemId };
  });
}

/** FR-09: never-confirmed drafts may be deleted; anything that reached a supplier is cancelled instead. */
export async function deleteItem(ctx: Ctx, bookingId: string, itemId: string) {
  return ctx.db.$transaction(async (tx) => {
    const b = await writableBooking(ctx, tx, bookingId, { direct: true });
    const item = await tx.bookingItem.findFirst({ where: { id: itemId, bookingId } });
    if (!item) throw notFound();
    if (b.confirmedAt || !["REQUESTED", "FAILED"].includes(item.status)) throw conflict("CANCEL_INSTEAD", "This service must be cancelled, not deleted");
    await tx.bookingItem.delete({ where: { id: itemId } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking_item.deleted", entityType: "BookingItem", entityId: itemId, parentEntityType: "Booking", parentEntityId: bookingId, metadata: { description: item.description } });
    await recalc(tx, ctx.tenant.id, bookingId, ctx.actor);
  });
}

/** §8.3 with BKG-05/06 requirements. These record what happened at the supplier (BKG-07); nothing is sent anywhere. */
export async function changeItemStatus(ctx: Ctx, bookingId: string, itemId: string, input: z.infer<typeof itemStatusSchema>) {
  return ctx.db.$transaction(async (tx) => {
    await writableBooking(ctx, tx, bookingId);
    const item = await tx.bookingItem.findFirst({ where: { id: itemId, bookingId }, include: { passengers: true } });
    if (!item) throw notFound();
    const to = input.status as BookingItemStatus;
    if (!canTransition(item.status, to)) throw new AppError(409, "INVALID_STATE_TRANSITION", `Cannot change from ${item.status} to ${to}`); // BKG-02
    const confirmation = input.supplierConfirmation ?? item.supplierConfirmation;
    const pnr = input.pnr ?? item.pnr;
    if ((to === "CONFIRMED" || to === "ISSUED") && item.serviceType !== "OTHER" && !confirmation && !pnr)
      throw unprocessable("CONFIRMATION_REQUIRED", "Enter the supplier confirmation number or PNR", "supplierConfirmation");
    const deadline = input.optionDeadline ? new Date(input.optionDeadline) : item.optionDeadline;
    if (to === "HELD" && !deadline) throw unprocessable("DEADLINE_REQUIRED", "Enter the option deadline", "optionDeadline");
    if (input.tickets.some((t) => !item.passengers.some((p) => p.bookingPassengerId === t.passengerId)))
      throw unprocessable("PASSENGER_NOT_ON_ITEM", "Tickets can only be recorded for passengers on this service", "tickets");
    for (const t of input.tickets) await tx.bookingItemPassenger.update({ where: { bookingItemId_bookingPassengerId: { bookingItemId: itemId, bookingPassengerId: t.passengerId } }, data: { ticketNumber: t.ticketNumber } });
    if (to === "ISSUED" && item.serviceType === "FLIGHT") {
      const pax = await tx.bookingItemPassenger.findMany({ where: { bookingItemId: itemId } });
      if (!pax.length || pax.some((p) => !p.ticketNumber)) throw unprocessable("TICKETS_REQUIRED", "Every passenger on this flight needs a ticket number", "tickets");
    }
    await tx.bookingItem.update({ where: { id: itemId }, data: { status: to, supplierConfirmation: confirmation, pnr, optionDeadline: to === "HELD" ? deadline : item.optionDeadline } });
    await history(tx, ctx.tenant.id, bookingId, item.status, to, ctx.actor, input.reason, itemId);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking_item.status_changed", entityType: "BookingItem", entityId: itemId, parentEntityType: "Booking", parentEntityId: bookingId, changes: { status: [item.status, to] }, metadata: { supplierConfirmation: confirmation, pnr, tickets: input.tickets.length } });
    const status = await recalc(tx, ctx.tenant.id, bookingId, ctx.actor);
    return { id: itemId, status: to, bookingStatus: status };
  });
}

export async function cancelItem(ctx: Ctx, bookingId: string, itemId: string, input: z.infer<typeof cancelItemSchema>) {
  authorize(ctx, "booking:cancel");
  return ctx.db.$transaction(async (tx) => {
    const b = await writableBooking(ctx, tx, bookingId);
    assertWritable(ctx, "booking:cancel", b);
    const item = await tx.bookingItem.findFirst({ where: { id: itemId, bookingId } });
    if (!item) throw notFound();
    if (!canTransition(item.status, "CANCELLED")) throw new AppError(409, "INVALID_STATE_TRANSITION", "This service is already cancelled");
    await tx.bookingItem.update({ where: { id: itemId }, data: { status: "CANCELLED" } });
    await tx.bookingItemCancellation.create({
      data: { tenantId: ctx.tenant.id, bookingItemId: itemId, reason: input.reason, supplierFee: input.supplierFee, agencyFee: input.agencyFee, expectedSupplierRefund: input.expectedSupplierRefund, cancelledById: ctx.user.id },
    });
    await history(tx, ctx.tenant.id, bookingId, item.status, "CANCELLED", ctx.actor, input.reason, itemId);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking_item.cancelled", entityType: "BookingItem", entityId: itemId, parentEntityType: "Booking", parentEntityId: bookingId, changes: { status: [item.status, "CANCELLED"] }, metadata: { reason: input.reason, supplierFee: input.supplierFee, agencyFee: input.agencyFee } });
    const status = await recalc(tx, ctx.tenant.id, bookingId, ctx.actor);
    // BKG-15: credit note / refund suggestions arrive with invoicing in Phase 3.
    return { id: itemId, bookingStatus: status, wasHeld: item.status === "HELD" };
  });
}

// ───────── Passengers (§8.4) ─────────

async function travelerSnapshot(tx: TenantTx, customerId: string, travelerId: string) {
  const t = await tx.traveler.findFirst({
    where: { id: travelerId, customerId, archivedAt: null },
    include: { documents: { where: { archivedAt: null }, orderBy: [{ expiryDate: "desc" }, { createdAt: "desc" }] } },
  });
  if (!t) throw unprocessable("INVALID_TRAVELER", "Traveler not found for this customer", "travelerId");
  const doc = t.documents.find((d) => d.type === "PASSPORT") ?? t.documents[0];
  return {
    travelerId: t.id, title: t.title, firstName: t.firstName, middleName: t.middleName, lastName: t.lastName, gender: t.gender, dateOfBirth: t.dateOfBirth, nationality: t.nationality,
    // Snapshot of the document as used for this trip (BKG-09); the ciphertext is copied, never decrypted here.
    ...(doc ? { docType: doc.type, docNumberEnc: doc.numberEnc, docNumberHash: doc.numberHash, docLast4: doc.numberLast4, docExpiry: doc.expiryDate } : {}),
  };
}

export async function addPassenger(ctx: Ctx, bookingId: string, input: z.infer<typeof passengerSchema>) {
  return ctx.db.$transaction(async (tx) => {
    const b = await writableBooking(ctx, tx, bookingId, { direct: true });
    const base = input.travelerId
      ? await travelerSnapshot(tx, b.customerId, input.travelerId)
      : {
          travelerId: null, title: input.title ?? null, firstName: input.firstName!.toUpperCase(), middleName: input.middleName?.toUpperCase() ?? null, lastName: input.lastName!.toUpperCase(),
          gender: input.gender ?? null, dateOfBirth: input.dateOfBirth ? day(input.dateOfBirth) : null, nationality: input.nationality ?? null,
          ...(input.docNumber ? { docType: input.docType!, docNumberEnc: encrypt(normalizeId(input.docNumber)), docNumberHash: lookupHash(input.docNumber), docLast4: last4(input.docNumber), docExpiry: input.docExpiry ? day(input.docExpiry) : null } : {}),
        };
    const type = paxType(isoDate(base.dateOfBirth), isoDate(b.travelStartDate) ?? today());
    const count = await tx.bookingPassenger.count({ where: { bookingId } });
    const isLead = input.isLead || count === 0; // BKG-08: exactly one lead
    if (isLead) await tx.bookingPassenger.updateMany({ where: { bookingId }, data: { isLead: false } });
    if (input.infantOfPassengerId) await assertInfantLink(tx, bookingId, type, input.infantOfPassengerId);
    const p = await tx.bookingPassenger.create({ data: { ...base, tenantId: ctx.tenant.id, bookingId, paxType: type, isLead, infantOfPassengerId: input.infantOfPassengerId ?? null } as Prisma.BookingPassengerUncheckedCreateInput });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking_passenger.added", entityType: "BookingPassenger", entityId: p.id, parentEntityType: "Booking", parentEntityId: bookingId, metadata: { name: `${p.firstName} ${p.lastName}`, paxType: type, fromTraveler: !!input.travelerId } });
    await tx.booking.update({ where: { id: bookingId }, data: { version: { increment: 1 } } });
    return { id: p.id, paxType: type, isLead };
  });
}

/** BKG-10: an infant travels on an adult of the same booking; one infant per adult. */
async function assertInfantLink(tx: TenantTx, bookingId: string, type: string, adultId: string, selfId?: string) {
  if (type !== "INF") throw unprocessable("NOT_AN_INFANT", "Only infants (under 2) are linked to an adult", "infantOfPassengerId");
  const adult = await tx.bookingPassenger.findFirst({ where: { id: adultId, bookingId }, include: { infants: true } });
  if (!adult || adult.paxType !== "ADT") throw unprocessable("INVALID_ADULT", "Choose an adult passenger on this booking", "infantOfPassengerId");
  if (adult.infants.some((i) => i.id !== selfId)) throw unprocessable("ADULT_HAS_INFANT", "This adult already travels with an infant", "infantOfPassengerId");
}

export async function removePassenger(ctx: Ctx, bookingId: string, passengerId: string) {
  return ctx.db.$transaction(async (tx) => {
    await writableBooking(ctx, tx, bookingId, { direct: true });
    const p = await tx.bookingPassenger.findFirst({ where: { id: passengerId, bookingId }, include: { infants: true } });
    if (!p) throw notFound();
    if (p.infants.length) throw unprocessable("HAS_INFANT", "Remove or relink the infant first");
    await tx.bookingPassenger.delete({ where: { id: passengerId } });
    if (p.isLead) {
      const next = await tx.bookingPassenger.findFirst({ where: { bookingId }, orderBy: { createdAt: "asc" } });
      if (next) await tx.bookingPassenger.update({ where: { id: next.id }, data: { isLead: true } });
    }
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking_passenger.removed", entityType: "BookingPassenger", entityId: passengerId, parentEntityType: "Booking", parentEntityId: bookingId, metadata: { name: `${p.firstName} ${p.lastName}` } });
    await tx.booking.update({ where: { id: bookingId }, data: { version: { increment: 1 } } });
  });
}

/** BKG-09 helper: refresh a passenger snapshot from the traveler profile, only when the user asks. */
export async function refreshPassengerFromProfile(ctx: Ctx, bookingId: string, passengerId: string) {
  return ctx.db.$transaction(async (tx) => {
    const b = await writableBooking(ctx, tx, bookingId, { direct: true });
    const p = await tx.bookingPassenger.findFirst({ where: { id: passengerId, bookingId } });
    if (!p) throw notFound();
    if (!p.travelerId) throw unprocessable("NO_PROFILE", "This passenger was entered manually");
    const snap = await travelerSnapshot(tx, b.customerId, p.travelerId);
    await tx.bookingPassenger.update({ where: { id: passengerId }, data: { ...snap, paxType: paxType(isoDate(snap.dateOfBirth), isoDate(b.travelStartDate) ?? today()) } as Prisma.BookingPassengerUncheckedUpdateInput });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking_passenger.refreshed", entityType: "BookingPassenger", entityId: passengerId, parentEntityType: "Booking", parentEntityId: bookingId });
  });
}

export async function revealPassengerDocument(ctx: Ctx, bookingId: string, passengerId: string) {
  authorize(ctx, "traveldoc:read");
  const b = await loadBooking(ctx, bookingId);
  if (!can(ctx, "traveldoc:reveal") || !inScope(ctx, "traveldoc:reveal", b)) throw forbidden();
  const p = await ctx.db.bookingPassenger.findFirst({ where: { id: passengerId, bookingId } });
  if (!p) throw notFound();
  if (!p.docNumberEnc) return { number: null };
  await audit(ctx.db, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "traveldoc.revealed", entityType: "BookingPassenger", entityId: passengerId, parentEntityType: "Booking", parentEntityId: bookingId });
  return { number: decrypt(p.docNumberEnc) };
}

/** Which passengers travel on a service. Allowed until the service is issued. */
export async function setItemPassengers(ctx: Ctx, bookingId: string, itemId: string, passengerIds: string[]) {
  return ctx.db.$transaction(async (tx) => {
    await writableBooking(ctx, tx, bookingId);
    const item = await tx.bookingItem.findFirst({ where: { id: itemId, bookingId } });
    if (!item) throw notFound();
    if (!["REQUESTED", "ON_REQUEST", "HELD", "CONFIRMED", "FAILED"].includes(item.status)) throw conflict("ITEM_LOCKED", "Passengers cannot change after issue or cancellation");
    const pax = await tx.bookingPassenger.findMany({ where: { bookingId, id: { in: passengerIds } } });
    if (pax.length !== new Set(passengerIds).size) throw unprocessable("INVALID_PASSENGER", "Unknown passenger", "passengerIds");
    if (item.serviceType === "FLIGHT")
      for (const inf of pax.filter((p) => p.paxType === "INF"))
        if (!inf.infantOfPassengerId || !passengerIds.includes(inf.infantOfPassengerId)) throw unprocessable("INFANT_WITHOUT_ADULT", "An infant flies with their linked adult", "passengerIds");
    await tx.bookingItemPassenger.deleteMany({ where: { bookingItemId: itemId, bookingPassengerId: { notIn: passengerIds } } });
    await tx.bookingItemPassenger.createMany({ data: passengerIds.map((id) => ({ tenantId: ctx.tenant.id, bookingItemId: itemId, bookingPassengerId: id })), skipDuplicates: true });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking_item.passengers_set", entityType: "BookingItem", entityId: itemId, parentEntityType: "Booking", parentEntityId: bookingId, metadata: { passengerIds } });
    await tx.booking.update({ where: { id: bookingId }, data: { version: { increment: 1 } } });
  });
}

// ───────── Amendments (BKG-18/19) ─────────

export async function createAmendment(ctx: Ctx, bookingId: string, input: z.infer<typeof amendmentSchema>) {
  authorize(ctx, "booking:amend");
  return ctx.db.$transaction(async (tx) => {
    const b = await writableBooking(ctx, tx, bookingId);
    assertWritable(ctx, "booking:amend", b);
    if (isDirectlyEditable(b.status)) throw conflict("AMENDMENT_NOT_NEEDED", "Draft bookings are edited directly");
    for (const op of input.operations) {
      if (op.op === "updateItem" && !(await tx.bookingItem.count({ where: { id: op.itemId, bookingId } }))) throw unprocessable("INVALID_ITEM", "Unknown service", "operations");
      if (op.op === "updatePassenger" && !(await tx.bookingPassenger.count({ where: { id: op.passengerId, bookingId } }))) throw unprocessable("INVALID_PASSENGER", "Unknown passenger", "operations");
    }
    const number = (await tx.bookingAmendment.count({ where: { bookingId } })) + 1;
    const a = await tx.bookingAmendment.create({
      data: { tenantId: ctx.tenant.id, bookingId, number, reason: input.reason, operations: input.operations as Prisma.InputJsonValue, supplierFee: input.supplierFee, agencyFee: input.agencyFee, createdById: ctx.user.id },
    });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking_amendment.created", entityType: "BookingAmendment", entityId: a.id, parentEntityType: "Booking", parentEntityId: bookingId, metadata: { number, operations: input.operations.length } });
    await tx.booking.update({ where: { id: bookingId }, data: { version: { increment: 1 } } });
    return { id: a.id, number };
  });
}

/** Applies every operation in one transaction and records the diff and the price difference (BKG-19). */
export async function applyAmendment(ctx: Ctx, bookingId: string, amendmentId: string) {
  authorize(ctx, "booking:amend");
  return ctx.db.$transaction(async (tx) => {
    const b = await writableBooking(ctx, tx, bookingId);
    assertWritable(ctx, "booking:amend", b);
    const a = await tx.bookingAmendment.findFirst({ where: { id: amendmentId, bookingId } });
    if (!a) throw notFound();
    if (a.status !== "DRAFT") throw conflict("AMENDMENT_CLOSED", "This amendment was already applied or cancelled");
    const ops = a.operations as z.infer<typeof amendmentSchema>["operations"];
    const changes: { op: string; target: string; changes: unknown }[] = [];
    for (const op of ops) {
      if (op.op === "updateItem") changes.push({ op: op.op, target: op.itemId, changes: await applyItemChanges(ctx, tx, b, op.itemId, op.changes) });
      else if (op.op === "addItem") {
        const data = await resolveItem(ctx, tx, b, op.item);
        const sortOrder = await tx.bookingItem.count({ where: { bookingId } });
        const item = await tx.bookingItem.create({ data: { ...data, tenantId: ctx.tenant.id, bookingId, sortOrder } as Prisma.BookingItemUncheckedCreateInput });
        await history(tx, ctx.tenant.id, bookingId, null, "REQUESTED", ctx.actor, `amendment ${a.number}`, item.id);
        changes.push({ op: op.op, target: item.id, changes: { description: item.description } });
      } else {
        const p = await tx.bookingPassenger.findFirstOrThrow({ where: { id: op.passengerId, bookingId } });
        const data = {
          ...(op.changes.firstName ? { firstName: op.changes.firstName.toUpperCase() } : {}),
          ...(op.changes.lastName ? { lastName: op.changes.lastName.toUpperCase() } : {}),
          ...(op.changes.middleName !== undefined ? { middleName: op.changes.middleName?.toUpperCase() ?? null } : {}),
          ...(op.changes.title !== undefined ? { title: op.changes.title } : {}),
          ...(op.changes.dateOfBirth !== undefined ? { dateOfBirth: op.changes.dateOfBirth ? day(op.changes.dateOfBirth) : null } : {}),
          ...(op.changes.docExpiry !== undefined ? { docExpiry: op.changes.docExpiry ? day(op.changes.docExpiry) : null } : {}),
        };
        await tx.bookingPassenger.update({ where: { id: p.id }, data });
        changes.push({ op: op.op, target: p.id, changes: diff(p, data) });
      }
    }
    const beforeTotal = b.grandTotal;
    await tx.bookingAmendment.update({ where: { id: amendmentId }, data: { status: "APPLIED", appliedById: ctx.user.id, appliedAt: new Date(), changes: changes as Prisma.InputJsonValue } });
    await recalc(tx, ctx.tenant.id, bookingId, ctx.actor);
    const afterB = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const priceDifference = afterB.grandTotal.minus(beforeTotal);
    await tx.bookingAmendment.update({ where: { id: amendmentId }, data: { priceDifference } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking.amended", entityType: "Booking", entityId: bookingId, changes: { grandTotal: [beforeTotal.toString(), afterB.grandTotal.toString()] }, metadata: { amendment: a.number, operations: changes.length } });
    // Phase 3: a positive difference on invoiced items offers an additional invoice, a negative one a credit note.
    return { id: amendmentId, priceDifference: priceDifference.toString(), grandTotal: afterB.grandTotal.toString() };
  });
}

export async function cancelAmendment(ctx: Ctx, bookingId: string, amendmentId: string) {
  authorize(ctx, "booking:amend");
  await ctx.db.$transaction(async (tx) => {
    const b = await writableBooking(ctx, tx, bookingId);
    assertWritable(ctx, "booking:amend", b);
    const res = await tx.bookingAmendment.updateMany({ where: { id: amendmentId, bookingId, status: "DRAFT" }, data: { status: "CANCELLED" } });
    if (res.count !== 1) throw notFound();
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "booking_amendment.cancelled", entityType: "BookingAmendment", entityId: amendmentId, parentEntityType: "Booking", parentEntityId: bookingId });
  });
}

// ───────── Itinerary (§8.5) ─────────

export async function addItineraryNote(ctx: Ctx, bookingId: string, input: z.infer<typeof itineraryNoteSchema>) {
  return ctx.db.$transaction(async (tx) => {
    await writableBooking(ctx, tx, bookingId);
    const n = await tx.itineraryNote.create({ data: { tenantId: ctx.tenant.id, bookingId, date: day(input.date), textEn: input.textEn ?? null, textAr: input.textAr ?? null } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "itinerary_note.created", entityType: "ItineraryNote", entityId: n.id, parentEntityType: "Booking", parentEntityId: bookingId });
    return n;
  });
}

export async function deleteItineraryNote(ctx: Ctx, bookingId: string, noteId: string) {
  await ctx.db.$transaction(async (tx) => {
    await writableBooking(ctx, tx, bookingId);
    await tx.itineraryNote.delete({ where: { id: noteId, bookingId } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "itinerary_note.deleted", entityType: "ItineraryNote", entityId: noteId, parentEntityType: "Booking", parentEntityId: bookingId });
  });
}

async function itineraryFor(db: TenantTx, bookingId: string, locale: "ar" | "en") {
  const b = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { items: { orderBy: { sortOrder: "asc" } }, itineraryNotes: true, passengers: { orderBy: [{ isLead: "desc" }, { createdAt: "asc" }], select: { title: true, firstName: true, lastName: true, paxType: true } }, customer: { select: { displayName: true } } },
  });
  const entries = buildItinerary(
    b.items.map((i) => ({ ...i, startDate: isoDate(i.startDate)!, endDate: isoDate(i.endDate)!, details: i.details as Record<string, unknown> })),
    b.itineraryNotes.map((n) => ({ date: isoDate(n.date)!, text: (locale === "ar" ? n.textAr || n.textEn : n.textEn || n.textAr) ?? "" })),
  );
  return { reference: b.reference, status: b.status, customer: b.customer.displayName, travelStartDate: isoDate(b.travelStartDate), travelEndDate: isoDate(b.travelEndDate), customerNotes: b.customerNotes, passengers: b.passengers, entries };
}

export async function getItinerary(ctx: Ctx, bookingId: string) {
  await loadBooking(ctx, bookingId);
  return itineraryFor(ctx.db, bookingId, ctx.user.locale);
}

// BKG-13: signed, expiring, read-only link. Contains no passport data.
const LINK_TTL_DAYS = 30;

export async function createItineraryLink(ctx: Ctx, bookingId: string) {
  const b = await loadBooking(ctx, bookingId);
  const { token, expiresAt } = createLink("itinerary", ctx.tenant.id, b.id, LINK_TTL_DAYS);
  await audit(ctx.db, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "itinerary.link_created", entityType: "Booking", entityId: bookingId, metadata: { expiresAt: expiresAt.toISOString() } });
  return { url: `${env().APP_URL}/itinerary/${token}`, expiresAt };
}

export async function publicItinerary(token: string, locale: "ar" | "en") {
  const link = verifyLink("itinerary", token);
  if (!link) return null;
  const db = tenantDb(link.tenantId);
  const exists = await db.booking.findFirst({ where: { id: link.id, status: { not: "CANCELLED" } }, select: { id: true } });
  if (!exists) return null;
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: link.tenantId }, select: { legalNameEn: true, legalNameAr: true, tradeNameEn: true, tradeNameAr: true, phone: true, email: true, primaryColor: true } });
  return { agency: tenant, ...(await itineraryFor(db, link.id, locale)) };
}

// ───────── Scheduled work ─────────

/** §8.2: issued/confirmed bookings become COMPLETED the day after travel ends (nightly job, all tenants). */
export async function completeFinishedBookings(now = new Date()) {
  const cutoff = new Date(now.getTime() - 86_400_000);
  const due = await prisma.booking.findMany({ where: { status: { in: ["CONFIRMED", "ISSUED"] }, travelEndDate: { lt: day(cutoff.toISOString().slice(0, 10)) } }, select: { id: true, tenantId: true, status: true } });
  for (const b of due) {
    await tenantDb(b.tenantId).$transaction(async (tx) => {
      const res = await tx.booking.updateMany({ where: { id: b.id, status: b.status }, data: { status: "COMPLETED", version: { increment: 1 } } });
      if (!res.count) return;
      await history(tx, b.tenantId, b.id, b.status, "COMPLETED", { type: "SYSTEM", id: null }, "travel ended");
      await audit(tx, { tenantId: b.tenantId, actor: { type: "SYSTEM", id: null }, action: "booking.completed", entityType: "Booking", entityId: b.id, changes: { status: [b.status, "COMPLETED"] } });
    });
  }
  return due.length;
}
