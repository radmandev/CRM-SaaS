import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { type TenantTx } from "@/server/db";
import { audit, diff } from "@/server/audit";
import { authorize, can, type Ctx } from "@/server/context";
import { AppError, conflict, forbidden, notFound, unprocessable } from "@/server/errors";
import { after, page } from "@/server/pagination";
import { assertBranchAllowed, assertWritable, inScope, scopeWhere } from "@/server/scope";
import { decrypt, encrypt, last4, lookupHash, mask, normalizeId } from "@/server/crypto";
import { nextSequenceValue } from "@/server/db/raw/sequences";
import type {
  contactSchema, customerListQuery, customerSchema, customerUpdateSchema, interactionSchema, travelDocumentSchema, travelerSchema,
} from "@/lib/schemas-travel";

type CustomerInput = z.infer<typeof customerSchema>;

export const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : s === null ? null : undefined);

// ───────── Customers (§6.1) ─────────

const displayNameOf = (c: CustomerInput) => (c.type === "INDIVIDUAL" ? `${c.firstName} ${c.lastName}`.trim() : c.displayName!);

function customerData(c: CustomerInput) {
  return {
    type: c.type,
    displayName: displayNameOf(c),
    nameAr: c.nameAr ?? null,
    firstName: c.type === "INDIVIDUAL" ? c.firstName : null,
    lastName: c.type === "INDIVIDUAL" ? c.lastName : null,
    lifecycleStage: c.lifecycleStage,
    source: c.source ?? null,
    phone: c.phone ?? null,
    email: c.email ?? null,
    gender: c.gender ?? null,
    dateOfBirth: toDate(c.dateOfBirth) ?? null,
    nationality: c.nationality ?? null,
    vatNumber: c.vatNumber ?? null,
    crNumber: c.crNumber ?? null,
    address: c.address ?? null,
    creditLimit: c.creditLimit ?? null,
    paymentTermsDays: c.paymentTermsDays,
    preferredLocale: c.preferredLocale,
    notes: c.notes ?? null,
  };
}

/** CRM-01: same phone or email within the tenant. Only matches the user may see are returned. */
async function findDuplicates(ctx: Ctx, c: { phone?: string | null; email?: string | null }, excludeId?: string) {
  const or = [...(c.phone ? [{ phone: c.phone }] : []), ...(c.email ? [{ email: c.email }] : [])];
  if (!or.length) return [];
  return ctx.db.customer.findMany({
    where: { OR: or, mergedIntoId: null, ...(excludeId ? { id: { not: excludeId } } : {}), ...scopeWhere(ctx, "customer:read") },
    select: { id: true, code: true, displayName: true, phone: true, email: true },
    take: 5,
  });
}

async function assertActiveMember(tx: TenantTx, membershipId: string) {
  if (!(await tx.membership.count({ where: { id: membershipId, status: "ACTIVE" } }))) throw unprocessable("INVALID_OWNER", "The owner must be an active member", "ownerId");
}

async function setTags(tx: TenantTx, tenantId: string, customerId: string, names: string[]) {
  await tx.customerTag.deleteMany({ where: { customerId } });
  for (const name of [...new Set(names)]) {
    const tag = await tx.tag.upsert({ where: { tenantId_name: { tenantId, name } }, create: { tenantId, name }, update: {} });
    await tx.customerTag.create({ data: { tenantId, customerId, tagId: tag.id } });
  }
}

export async function listCustomers(ctx: Ctx, q: z.infer<typeof customerListQuery>) {
  const rows = await ctx.db.customer.findMany({
    where: {
      ...scopeWhere(ctx, "customer:read"),
      mergedIntoId: null,
      archivedAt: q.archived === "true" ? { not: null } : null,
      ...(q.stage ? { lifecycleStage: q.stage } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.q
        ? { OR: [{ displayName: { contains: q.q, mode: "insensitive" } }, { nameAr: { contains: q.q } }, { code: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }, { phone: { contains: q.q.replace(/\s/g, "") } }] }
        : {}),
      ...after(q.cursor, "createdAt", "desc"),
    },
    select: { id: true, code: true, type: true, displayName: true, nameAr: true, phone: true, email: true, lifecycleStage: true, branchId: true, ownerId: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  return page(rows, q.limit, (r) => r.createdAt);
}

async function loadCustomer(ctx: Ctx, id: string) {
  const c = await ctx.db.customer.findFirst({ where: { id, ...scopeWhere(ctx, "customer:read") } });
  if (!c) throw notFound();
  return c;
}

export async function getCustomer(ctx: Ctx, id: string) {
  const c = await ctx.db.customer.findFirst({
    where: { id, ...scopeWhere(ctx, "customer:read") },
    include: {
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      tags: { include: { tag: true } },
      travelers: { where: { archivedAt: null }, orderBy: { createdAt: "asc" }, include: { documents: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } } } },
      mergedInto: { select: { id: true, code: true, displayName: true } },
    },
  });
  if (!c) throw notFound();
  const showDocs = can(ctx, "traveldoc:read");
  const { tags, travelers, ...rest } = c;
  const duplicates = c.mergedIntoId ? [] : await findDuplicates(ctx, c, c.id);
  return {
    ...rest,
    duplicates,
    dateOfBirth: isoDate(c.dateOfBirth),
    tags: tags.map((t) => t.tag.name),
    canWrite: can(ctx, "customer:write") && inScope(ctx, "customer:write", c),
    travelers: travelers.map(({ documents, ...t }) => ({
      ...t,
      dateOfBirth: isoDate(t.dateOfBirth),
      documents: showDocs ? documents.map(maskedDocument) : null,
    })),
  };
}

export async function createCustomer(ctx: Ctx, input: CustomerInput) {
  authorize(ctx, "customer:write");
  const branchId = input.branchId ?? ctx.membership.primaryBranchId;
  assertBranchAllowed(ctx, "customer:write", branchId);
  if (!input.confirmDuplicate) {
    const dupes = await findDuplicates(ctx, input);
    if (dupes.length) throw new AppError(409, "POSSIBLE_DUPLICATE", "A customer with this phone or email exists", [], {}, { duplicates: dupes });
  }
  return ctx.db.$transaction(async (tx) => {
    if (!(await tx.branch.count({ where: { id: branchId, archivedAt: null } }))) throw unprocessable("INVALID_BRANCH", "Branch not found", "branchId");
    const ownerId = input.ownerId ?? ctx.membership.id;
    if (input.ownerId) await assertActiveMember(tx, input.ownerId);
    const code = input.code ?? `C-${String(await nextSequenceValue(tx, ctx.tenant.id, "CUSTOMER", 0)).padStart(6, "0")}`;
    const c = await tx.customer.create({
      data: {
        ...customerData(input),
        tenantId: ctx.tenant.id,
        code,
        branchId,
        ownerId,
        marketingConsentAt: input.marketingConsent ? new Date() : null,
        marketingSource: input.marketingConsent ? "staff" : null,
        createdById: ctx.user.id,
      },
    });
    await setTags(tx, ctx.tenant.id, c.id, input.tags);
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "customer.created", entityType: "Customer", entityId: c.id, changes: diff({}, { ...customerData(input), code, branchId }) });
    return c;
  });
}

export async function updateCustomer(ctx: Ctx, id: string, input: z.infer<typeof customerUpdateSchema>) {
  const before = await loadCustomer(ctx, id);
  assertWritable(ctx, "customer:write", before);
  const branchId = input.branchId ?? before.branchId;
  if (branchId !== before.branchId) assertBranchAllowed(ctx, "customer:write", branchId);
  return ctx.db.$transaction(async (tx) => {
    if (input.ownerId && input.ownerId !== before.ownerId) await assertActiveMember(tx, input.ownerId);
    const data = {
      ...customerData(input),
      branchId,
      ownerId: input.ownerId ?? before.ownerId,
      ...(input.code && input.code !== before.code ? { code: input.code } : {}),
      marketingConsentAt: input.marketingConsent ? (before.marketingConsentAt ?? new Date()) : null,
      marketingSource: input.marketingConsent ? (before.marketingSource ?? "staff") : null,
    };
    // BKG-21 style optimistic locking.
    const res = await tx.customer.updateMany({ where: { id, version: input.version }, data: { ...data, version: { increment: 1 } } });
    if (res.count !== 1) throw conflict("VERSION_CONFLICT", "This customer was changed by someone else. Reload and try again.");
    await setTags(tx, ctx.tenant.id, id, input.tags);
    const changes = diff(before, data);
    if (changes) await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "customer.updated", entityType: "Customer", entityId: id, changes });
    return { id, version: input.version + 1 };
  });
}

export async function setCustomerArchived(ctx: Ctx, id: string, archived: boolean) {
  const c = await loadCustomer(ctx, id);
  assertWritable(ctx, "customer:write", c);
  if (c.mergedIntoId) throw unprocessable("CUSTOMER_MERGED", "Merged customers cannot be restored");
  await ctx.db.$transaction(async (tx) => {
    await tx.customer.update({ where: { id }, data: { archivedAt: archived ? (c.archivedAt ?? new Date()) : null, version: { increment: 1 } } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: archived ? "customer.archived" : "customer.restored", entityType: "Customer", entityId: id });
  });
}

/** CRM-03: move every reference to the surviving customer in one transaction, then archive the source. */
export async function mergeCustomers(ctx: Ctx, sourceId: string, intoId: string) {
  if (!["OWNER", "ADMIN", "BRANCH_MANAGER"].includes(ctx.membership.role)) throw forbidden();
  if (sourceId === intoId) throw unprocessable("MERGE_SAME", "Choose a different customer", "intoCustomerId");
  const [source, into] = [await loadCustomer(ctx, sourceId), await loadCustomer(ctx, intoId)];
  assertWritable(ctx, "customer:write", source);
  assertWritable(ctx, "customer:write", into);
  if (source.mergedIntoId || into.mergedIntoId || into.archivedAt) throw unprocessable("CUSTOMER_MERGED", "One of these customers is already merged or archived");
  return ctx.db.$transaction(async (tx) => {
    const moved = {
      travelers: (await tx.traveler.updateMany({ where: { customerId: sourceId }, data: { customerId: intoId } })).count,
      contacts: (await tx.customerContact.updateMany({ where: { customerId: sourceId }, data: { customerId: intoId, isPrimary: false } })).count,
      interactions: (await tx.interaction.updateMany({ where: { customerId: sourceId }, data: { customerId: intoId } })).count,
      bookings: (await tx.booking.updateMany({ where: { customerId: sourceId }, data: { customerId: intoId } })).count,
    };
    const sourceTags = await tx.customerTag.findMany({ where: { customerId: sourceId } });
    await tx.customerTag.createMany({ data: sourceTags.map((t) => ({ tenantId: ctx.tenant.id, customerId: intoId, tagId: t.tagId })), skipDuplicates: true });
    await tx.customerTag.deleteMany({ where: { customerId: sourceId } });
    await tx.customer.update({ where: { id: sourceId }, data: { mergedIntoId: intoId, archivedAt: new Date(), version: { increment: 1 } } });
    await tx.customer.update({ where: { id: intoId }, data: { version: { increment: 1 } } });
    const metadata = { from: { id: sourceId, code: source.code }, into: { id: intoId, code: into.code }, moved };
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "customer.merged_away", entityType: "Customer", entityId: sourceId, metadata });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "customer.merged_into", entityType: "Customer", entityId: intoId, metadata });
    return { intoId, moved };
  });
}

// ───────── Contacts (§6.2) ─────────

async function writableCustomer(ctx: Ctx, customerId: string) {
  const c = await loadCustomer(ctx, customerId);
  assertWritable(ctx, "customer:write", c);
  return c;
}

export async function saveContact(ctx: Ctx, customerId: string, input: z.infer<typeof contactSchema>, contactId?: string) {
  await writableCustomer(ctx, customerId);
  return ctx.db.$transaction(async (tx) => {
    // One primary contact per customer.
    if (input.isPrimary) await tx.customerContact.updateMany({ where: { customerId, ...(contactId ? { id: { not: contactId } } : {}) }, data: { isPrimary: false } });
    const data = { ...input, title: input.title ?? null, phone: input.phone ?? null, email: input.email ?? null };
    const contact = contactId
      ? await tx.customerContact.update({ where: { id: contactId, customerId }, data })
      : await tx.customerContact.create({ data: { ...data, tenantId: ctx.tenant.id, customerId } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: contactId ? "customer_contact.updated" : "customer_contact.created", entityType: "CustomerContact", entityId: contact.id, parentEntityType: "Customer", parentEntityId: customerId, changes: diff({}, data) });
    return contact;
  });
}

export async function deleteContact(ctx: Ctx, customerId: string, contactId: string) {
  await writableCustomer(ctx, customerId);
  await ctx.db.$transaction(async (tx) => {
    await tx.customerContact.delete({ where: { id: contactId, customerId } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "customer_contact.deleted", entityType: "CustomerContact", entityId: contactId, parentEntityType: "Customer", parentEntityId: customerId });
  });
}

// ───────── Travelers (§6.3) ─────────

function travelerData(t: z.infer<typeof travelerSchema>) {
  return {
    title: t.title ?? null,
    firstName: t.firstName.toUpperCase(),
    middleName: t.middleName?.toUpperCase() ?? null,
    lastName: t.lastName.toUpperCase(),
    nameAr: t.nameAr ?? null,
    gender: t.gender ?? null,
    dateOfBirth: toDate(t.dateOfBirth) ?? null,
    nationality: t.nationality ?? null,
    phone: t.phone ?? null,
    email: t.email ?? null,
    frequentFlyer: t.frequentFlyer as Prisma.InputJsonValue,
    preferences: t.preferences as Prisma.InputJsonValue,
  };
}

async function loadTraveler(ctx: Ctx, travelerId: string) {
  const t = await ctx.db.traveler.findFirst({ where: { id: travelerId, customer: scopeWhere(ctx, "customer:read") }, include: { customer: true } });
  if (!t) throw notFound();
  return t;
}

export async function createTraveler(ctx: Ctx, customerId: string, input: z.infer<typeof travelerSchema>) {
  await writableCustomer(ctx, customerId);
  return ctx.db.$transaction(async (tx) => {
    const t = await tx.traveler.create({ data: { ...travelerData(input), tenantId: ctx.tenant.id, customerId } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "traveler.created", entityType: "Traveler", entityId: t.id, parentEntityType: "Customer", parentEntityId: customerId });
    return t;
  });
}

export async function updateTraveler(ctx: Ctx, travelerId: string, input: z.infer<typeof travelerSchema>) {
  const before = await loadTraveler(ctx, travelerId);
  assertWritable(ctx, "customer:write", before.customer);
  return ctx.db.$transaction(async (tx) => {
    const data = travelerData(input);
    const t = await tx.traveler.update({ where: { id: travelerId }, data });
    const changes = diff(before, data);
    if (changes) await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "traveler.updated", entityType: "Traveler", entityId: travelerId, parentEntityType: "Customer", parentEntityId: before.customerId, changes });
    return t;
  });
}

export async function archiveTraveler(ctx: Ctx, travelerId: string) {
  const t = await loadTraveler(ctx, travelerId);
  assertWritable(ctx, "customer:write", t.customer);
  await ctx.db.$transaction(async (tx) => {
    await tx.traveler.update({ where: { id: travelerId }, data: { archivedAt: new Date() } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "traveler.archived", entityType: "Traveler", entityId: travelerId, parentEntityType: "Customer", parentEntityId: t.customerId });
  });
}

// ───────── Travel documents (§6.4, CRM-07/08) ─────────

type DocRow = { id: string; type: string; numberLast4: string; issuingCountry: string | null; nationality: string | null; issueDate: Date | null; expiryDate: Date | null; holderName: string | null; verifiedAt: Date | null };
export const maskedDocument = (d: DocRow) => ({
  id: d.id,
  type: d.type,
  number: mask(d.numberLast4),
  issuingCountry: d.issuingCountry,
  nationality: d.nationality,
  issueDate: isoDate(d.issueDate),
  expiryDate: isoDate(d.expiryDate),
  holderName: d.holderName,
  verifiedAt: d.verifiedAt,
});

function documentData(d: z.infer<typeof travelDocumentSchema>) {
  const number = normalizeId(d.number);
  return {
    type: d.type,
    numberEnc: encrypt(number),
    numberHash: lookupHash(number),
    numberLast4: last4(number),
    issuingCountry: d.issuingCountry ?? null,
    nationality: d.nationality ?? null,
    issueDate: toDate(d.issueDate) ?? null,
    expiryDate: toDate(d.expiryDate) ?? null,
    holderName: d.holderName ?? null,
  };
}

/** Audit-safe view of document data: the number appears only masked. */
const auditDoc = (d: ReturnType<typeof documentData>) => ({ ...d, numberEnc: undefined, numberHash: undefined, number: mask(d.numberLast4) });

export async function addTravelDocument(ctx: Ctx, travelerId: string, input: z.infer<typeof travelDocumentSchema>) {
  authorize(ctx, "traveldoc:read");
  const t = await loadTraveler(ctx, travelerId);
  assertWritable(ctx, "customer:write", t.customer);
  return ctx.db.$transaction(async (tx) => {
    const data = documentData(input);
    const doc = await tx.travelDocument.create({ data: { ...data, tenantId: ctx.tenant.id, travelerId } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "traveldoc.created", entityType: "TravelDocument", entityId: doc.id, parentEntityType: "Traveler", parentEntityId: travelerId, changes: diff({}, auditDoc(data)) });
    return maskedDocument(doc);
  });
}

export async function updateTravelDocument(ctx: Ctx, documentId: string, input: z.infer<typeof travelDocumentSchema>) {
  authorize(ctx, "traveldoc:read");
  const doc = await ctx.db.travelDocument.findFirst({ where: { id: documentId, archivedAt: null, traveler: { customer: scopeWhere(ctx, "customer:read") } }, include: { traveler: { include: { customer: true } } } });
  if (!doc) throw notFound();
  assertWritable(ctx, "customer:write", doc.traveler.customer);
  return ctx.db.$transaction(async (tx) => {
    const data = documentData(input);
    const updated = await tx.travelDocument.update({ where: { id: documentId }, data: { ...data, verifiedAt: null, verifiedById: null } });
    const changes = diff({ ...maskedDocument(doc), number: mask(doc.numberLast4) }, { ...maskedDocument({ ...updated }), number: mask(data.numberLast4) });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "traveldoc.updated", entityType: "TravelDocument", entityId: documentId, parentEntityType: "Traveler", parentEntityId: doc.travelerId, changes });
    return maskedDocument(updated);
  });
}

export async function archiveTravelDocument(ctx: Ctx, documentId: string) {
  authorize(ctx, "traveldoc:read");
  const doc = await ctx.db.travelDocument.findFirst({ where: { id: documentId, archivedAt: null, traveler: { customer: scopeWhere(ctx, "customer:read") } }, include: { traveler: { include: { customer: true } } } });
  if (!doc) throw notFound();
  assertWritable(ctx, "customer:write", doc.traveler.customer);
  await ctx.db.$transaction(async (tx) => {
    await tx.travelDocument.update({ where: { id: documentId }, data: { archivedAt: new Date() } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "traveldoc.archived", entityType: "TravelDocument", entityId: documentId, parentEntityType: "Traveler", parentEntityId: doc.travelerId });
  });
}

/**
 * CRM-07: the full number needs traveldoc:reveal within its scope (OWN = the customer's owner) and every reveal
 * is audit-logged. Branch or own scope is checked against the customer the traveler belongs to.
 */
export async function revealTravelDocument(ctx: Ctx, documentId: string) {
  authorize(ctx, "traveldoc:read");
  const doc = await ctx.db.travelDocument.findFirst({ where: { id: documentId, traveler: { customer: scopeWhere(ctx, "customer:read") } }, include: { traveler: { include: { customer: true } } } });
  if (!doc) throw notFound();
  if (!can(ctx, "traveldoc:reveal") || !inScope(ctx, "traveldoc:reveal", doc.traveler.customer)) throw forbidden();
  const number = decrypt(doc.numberEnc);
  await audit(ctx.db, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "traveldoc.revealed", entityType: "TravelDocument", entityId: documentId, parentEntityType: "Traveler", parentEntityId: doc.travelerId });
  return { id: doc.id, number };
}

/** CRM-08: find travelers by document number without decrypting anything. */
export async function findTravelersByDocument(ctx: Ctx, number: string) {
  authorize(ctx, "traveldoc:read");
  const docs = await ctx.db.travelDocument.findMany({
    where: { numberHash: lookupHash(number), archivedAt: null, traveler: { archivedAt: null, customer: scopeWhere(ctx, "customer:read") } },
    include: { traveler: { select: { id: true, firstName: true, lastName: true, customerId: true } } },
    take: 10,
  });
  return docs.map((d) => ({ ...d.traveler, document: maskedDocument(d) }));
}

// ───────── Interactions (§6.5) and timeline (CRM-12) ─────────

export async function logInteraction(ctx: Ctx, customerId: string, input: z.infer<typeof interactionSchema>) {
  await writableCustomer(ctx, customerId);
  return ctx.db.$transaction(async (tx) => {
    if (input.bookingId && !(await tx.booking.count({ where: { id: input.bookingId, customerId } }))) throw unprocessable("INVALID_BOOKING", "Booking not found for this customer", "bookingId");
    const i = await tx.interaction.create({
      data: { tenantId: ctx.tenant.id, customerId, bookingId: input.bookingId ?? null, channel: input.channel, direction: input.direction, subject: input.subject ?? null, body: input.body, occurredAt: new Date(input.occurredAt), userId: ctx.user.id },
    });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "interaction.logged", entityType: "Interaction", entityId: i.id, parentEntityType: "Customer", parentEntityId: customerId, metadata: { channel: i.channel, direction: i.direction } });
    return i;
  });
}

export async function customerTimeline(ctx: Ctx, customerId: string, limit = 50) {
  await loadCustomer(ctx, customerId);
  const [interactions, bookings, logs] = await Promise.all([
    ctx.db.interaction.findMany({ where: { customerId }, orderBy: { occurredAt: "desc" }, take: limit }),
    ctx.db.booking.findMany({ where: { customerId, ...scopeWhere(ctx, "booking:read") }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, reference: true, status: true, createdAt: true, travelStartDate: true } }),
    ctx.db.auditLog.findMany({ where: { OR: [{ entityType: "Customer", entityId: customerId }, { parentEntityType: "Customer", parentEntityId: customerId }] }, orderBy: { createdAt: "desc" }, take: limit }),
  ]);
  const names = new Map(
    (await ctx.db.membership.findMany({ where: { userId: { in: [...new Set([...interactions.map((i) => i.userId), ...logs.map((l) => l.actorId).filter((x): x is string => !!x)])] } }, select: { userId: true, user: { select: { name: true } } } })).map((m) => [m.userId, m.user.name]),
  );
  const events = [
    ...interactions.map((i) => ({ kind: "interaction" as const, at: i.occurredAt, id: i.id, title: i.subject ?? i.channel, body: i.body, channel: i.channel, direction: i.direction, by: names.get(i.userId) ?? null })),
    ...bookings.map((b) => ({ kind: "booking" as const, at: b.createdAt, id: b.id, title: b.reference, status: b.status, travelStartDate: isoDate(b.travelStartDate) })),
    ...logs.map((l) => ({ kind: "audit" as const, at: l.createdAt, id: l.id, title: l.action, by: (l.actorId && names.get(l.actorId)) || null })),
  ];
  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
