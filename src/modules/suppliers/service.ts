import type { z } from "zod";
import { audit, diff } from "@/server/audit";
import { authorize, can, type Ctx } from "@/server/context";
import { forbidden, notFound, unprocessable } from "@/server/errors";
import { after, page } from "@/server/pagination";
import { decrypt, encrypt, last4, mask } from "@/server/crypto";
import { D, type Money } from "@/server/money";
import type { commissionRuleSchema, productSchema, supplierContactSchema, supplierSchema } from "@/lib/schemas-travel";
import type { listQuery } from "@/lib/schemas";
import type { ServiceType } from "@/generated/prisma/enums";

// Suppliers and products are tenant-wide reference data (no branch). Any granted scope of supplier:read /
// product access means access to all of them; "branch" scope cannot apply to records without a branch (§4.6).

const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);

// ───────── Suppliers (§9.1) ─────────

function supplierData(s: z.infer<typeof supplierSchema>) {
  const iban = s.iban?.replace(/\s/g, "");
  return {
    type: s.type,
    code: s.code,
    nameEn: s.nameEn,
    nameAr: s.nameAr ?? null,
    country: s.country ?? null,
    city: s.city ?? null,
    address: s.address ?? null,
    phone: s.phone ?? null,
    email: s.email ?? null,
    website: s.website ?? null,
    vatNumber: s.vatNumber ?? null,
    crNumber: s.crNumber ?? null,
    defaultCurrency: s.defaultCurrency,
    paymentTermsDays: s.paymentTermsDays,
    prepaid: s.prepaid,
    iataCode: s.iataCode ?? null,
    notes: s.notes ?? null,
    // §9.1: IBAN encrypted at rest, masked in every response. `undefined` keeps the stored one.
    ...(iban ? { ibanEnc: encrypt(iban), ibanLast4: last4(iban) } : s.iban === null ? { ibanEnc: null, ibanLast4: null } : {}),
  };
}

const publicSupplier = <T extends { ibanEnc: string | null; ibanLast4: string | null }>({ ibanEnc: _enc, ...s }: T) => ({ ...s, iban: mask(s.ibanLast4) });
const auditable = (d: ReturnType<typeof supplierData>) => ({ ...d, ibanEnc: undefined, ibanLast4: undefined, ...("ibanLast4" in d ? { iban: mask(d.ibanLast4) } : {}) });

export async function listSuppliers(ctx: Ctx, q: z.infer<typeof listQuery> & { archived?: boolean; type?: string }) {
  authorize(ctx, "supplier:read");
  const rows = await ctx.db.supplier.findMany({
    where: {
      archivedAt: q.archived ? { not: null } : null,
      ...(q.type ? { type: q.type as never } : {}),
      ...(q.q ? { OR: [{ nameEn: { contains: q.q, mode: "insensitive" } }, { nameAr: { contains: q.q } }, { code: { contains: q.q, mode: "insensitive" } }] } : {}),
      ...after(q.cursor, "nameEn", "asc"),
    },
    orderBy: [{ nameEn: "asc" }, { id: "asc" }],
    take: q.limit + 1,
  });
  const p = page(rows, q.limit, (r) => r.nameEn);
  return { ...p, data: p.data.map(publicSupplier) };
}

export async function getSupplier(ctx: Ctx, id: string) {
  authorize(ctx, "supplier:read");
  const s = await ctx.db.supplier.findUnique({
    where: { id },
    include: { contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, commissionRules: { orderBy: { createdAt: "desc" }, include: { product: { select: { code: true, nameEn: true } } } } },
  });
  if (!s) throw notFound();
  return {
    ...publicSupplier(s),
    commissionRules: s.commissionRules.map((r) => ({ ...r, validFrom: isoDate(r.validFrom), validTo: isoDate(r.validTo) })),
    canWrite: can(ctx, "supplier:write"),
  };
}

export async function createSupplier(ctx: Ctx, input: z.infer<typeof supplierSchema>) {
  authorize(ctx, "supplier:write");
  return ctx.db.$transaction(async (tx) => {
    const data = supplierData(input);
    const s = await tx.supplier.create({ data: { ...data, tenantId: ctx.tenant.id } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "supplier.created", entityType: "Supplier", entityId: s.id, changes: diff({}, auditable(data)) });
    return publicSupplier(s);
  });
}

export async function updateSupplier(ctx: Ctx, id: string, input: z.infer<typeof supplierSchema>) {
  authorize(ctx, "supplier:write");
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.supplier.findUniqueOrThrow({ where: { id } });
    const data = supplierData(input);
    const s = await tx.supplier.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
    const changes = diff({ ...before, iban: mask(before.ibanLast4), ibanEnc: undefined, ibanLast4: undefined }, auditable(data));
    if (changes) await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "supplier.updated", entityType: "Supplier", entityId: id, changes });
    return publicSupplier(s);
  });
}

export async function setSupplierArchived(ctx: Ctx, id: string, archived: boolean) {
  authorize(ctx, "supplier:write");
  await ctx.db.$transaction(async (tx) => {
    const s = await tx.supplier.findUniqueOrThrow({ where: { id } });
    await tx.supplier.update({ where: { id }, data: { archivedAt: archived ? (s.archivedAt ?? new Date()) : null } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: archived ? "supplier.archived" : "supplier.restored", entityType: "Supplier", entityId: id });
  });
}

/** IBAN reveal: same rule as other sensitive financial details — finance roles and managers (supplier:write ALL). */
export async function revealSupplierIban(ctx: Ctx, id: string) {
  if (authorize(ctx, "supplier:write") !== "ALL" && ctx.membership.role !== "BRANCH_MANAGER") throw forbidden();
  const s = await ctx.db.supplier.findUnique({ where: { id } });
  if (!s) throw notFound();
  if (!s.ibanEnc) return { iban: null };
  await audit(ctx.db, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "supplier.iban_revealed", entityType: "Supplier", entityId: id });
  return { iban: decrypt(s.ibanEnc) };
}

export async function saveSupplierContact(ctx: Ctx, supplierId: string, input: z.infer<typeof supplierContactSchema>, contactId?: string) {
  authorize(ctx, "supplier:write");
  return ctx.db.$transaction(async (tx) => {
    await tx.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    if (input.isPrimary) await tx.supplierContact.updateMany({ where: { supplierId, ...(contactId ? { id: { not: contactId } } : {}) }, data: { isPrimary: false } });
    const data = { name: input.name, role: input.role ?? null, phone: input.phone ?? null, email: input.email ?? null, isPrimary: input.isPrimary };
    const c = contactId
      ? await tx.supplierContact.update({ where: { id: contactId, supplierId }, data })
      : await tx.supplierContact.create({ data: { ...data, tenantId: ctx.tenant.id, supplierId } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: contactId ? "supplier_contact.updated" : "supplier_contact.created", entityType: "SupplierContact", entityId: c.id, parentEntityType: "Supplier", parentEntityId: supplierId, changes: diff({}, data) });
    return c;
  });
}

export async function deleteSupplierContact(ctx: Ctx, supplierId: string, contactId: string) {
  authorize(ctx, "supplier:write");
  await ctx.db.$transaction(async (tx) => {
    await tx.supplierContact.delete({ where: { id: contactId, supplierId } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "supplier_contact.deleted", entityType: "SupplierContact", entityId: contactId, parentEntityType: "Supplier", parentEntityId: supplierId });
  });
}

// ───────── Commission rules (SUP-01) ─────────

export async function addCommissionRule(ctx: Ctx, supplierId: string, input: z.infer<typeof commissionRuleSchema>) {
  authorize(ctx, "supplier:write");
  return ctx.db.$transaction(async (tx) => {
    await tx.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    if (input.productId && !(await tx.product.count({ where: { id: input.productId } }))) throw unprocessable("INVALID_PRODUCT", "Product not found", "productId");
    const data = {
      serviceType: input.serviceType ?? null,
      productId: input.productId ?? null,
      ratePercent: input.kind === "PERCENT" ? input.ratePercent! : null,
      fixedAmount: input.kind === "FIXED" ? input.fixedAmount! : null,
      currency: input.kind === "FIXED" ? input.currency! : null,
      validFrom: toDate(input.validFrom),
      validTo: toDate(input.validTo),
      notes: input.notes ?? null,
    };
    const r = await tx.commissionRule.create({ data: { ...data, tenantId: ctx.tenant.id, supplierId } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "commission_rule.created", entityType: "CommissionRule", entityId: r.id, parentEntityType: "Supplier", parentEntityId: supplierId, changes: diff({}, data) });
    return r;
  });
}

export async function deleteCommissionRule(ctx: Ctx, supplierId: string, ruleId: string) {
  authorize(ctx, "supplier:write");
  await ctx.db.$transaction(async (tx) => {
    await tx.commissionRule.delete({ where: { id: ruleId, supplierId } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "commission_rule.deleted", entityType: "CommissionRule", entityId: ruleId, parentEntityType: "Supplier", parentEntityId: supplierId });
  });
}

/**
 * SUP-01: most specific active rule wins (product > service type > supplier-wide), newest first on ties.
 * Returns the commission for `sellAmount`, or null when no rule applies. Users may override the prefill.
 */
export async function suggestCommission(db: Ctx["db"], supplierId: string, serviceType: ServiceType, productId: string | null, onDate: string, sellAmount: Money, currency: string): Promise<Money | null> {
  const day = new Date(`${onDate}T00:00:00Z`);
  const rules = await db.commissionRule.findMany({
    where: {
      supplierId,
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: day } }] },
        { OR: [{ validTo: null }, { validTo: { gte: day } }] },
        { OR: [{ productId: null }, ...(productId ? [{ productId }] : [])] },
        { OR: [{ serviceType: null }, { serviceType }] },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  const rank = (r: (typeof rules)[number]) => (r.productId ? 2 : 0) + (r.serviceType ? 1 : 0);
  const rule = rules.sort((a, b) => rank(b) - rank(a))[0];
  if (!rule) return null;
  if (rule.ratePercent) return sellAmount.times(rule.ratePercent).dividedBy(100).toDecimalPlaces(4);
  if (rule.fixedAmount && rule.currency === currency) return D(rule.fixedAmount);
  return null; // fixed amount in another currency: no automatic conversion (FX is entered per document)
}

// ───────── Products (§7.2) ─────────

function productData(p: z.infer<typeof productSchema>) {
  return {
    type: p.type,
    code: p.code,
    nameEn: p.nameEn,
    nameAr: p.nameAr ?? null,
    descriptionEn: p.descriptionEn ?? null,
    descriptionAr: p.descriptionAr ?? null,
    defaultSupplierId: p.defaultSupplierId ?? null,
    defaultCost: p.defaultCost,
    defaultSell: p.defaultSell,
    currency: p.currency,
    taxRateId: p.taxRateId ?? null,
    pricingModel: p.pricingModel,
    validFrom: toDate(p.validFrom),
    validTo: toDate(p.validTo),
    active: p.active,
  };
}

export async function listProducts(ctx: Ctx, q: z.infer<typeof listQuery> & { type?: string; includeInactive?: boolean }) {
  const rows = await ctx.db.product.findMany({
    where: {
      ...(q.includeInactive ? {} : { active: true }),
      ...(q.type ? { type: q.type as never } : {}),
      ...(q.q ? { OR: [{ nameEn: { contains: q.q, mode: "insensitive" } }, { nameAr: { contains: q.q } }, { code: { contains: q.q, mode: "insensitive" } }] } : {}),
      ...after(q.cursor, "code", "asc"),
    },
    include: { defaultSupplier: { select: { id: true, nameEn: true } } },
    orderBy: [{ code: "asc" }, { id: "asc" }],
    take: q.limit + 1,
  });
  return page(rows, q.limit, (r) => r.code);
}

export async function getProduct(ctx: Ctx, id: string) {
  const p = await ctx.db.product.findUnique({ where: { id }, include: { components: { include: { componentProduct: { select: { id: true, code: true, nameEn: true, nameAr: true } } } }, defaultSupplier: { select: { id: true, nameEn: true } } } });
  if (!p) throw notFound();
  return { ...p, validFrom: isoDate(p.validFrom), validTo: isoDate(p.validTo), canWrite: can(ctx, "product:write") };
}

async function checkProductRefs(tx: Ctx["db"] | Parameters<Parameters<Ctx["db"]["$transaction"]>[0]>[0], input: z.infer<typeof productSchema>, selfId?: string) {
  if (input.defaultSupplierId && !(await tx.supplier.count({ where: { id: input.defaultSupplierId, archivedAt: null } }))) throw unprocessable("INVALID_SUPPLIER", "Supplier not found", "defaultSupplierId");
  if (input.taxRateId && !(await tx.taxRate.count({ where: { id: input.taxRateId, active: true } }))) throw unprocessable("INVALID_TAX_RATE", "Tax rate not found", "taxRateId");
  if (input.type !== "PACKAGE" && input.components.length) throw unprocessable("COMPONENTS_ONLY_FOR_PACKAGES", "Only packages have components", "components");
  const ids = input.components.map((c) => c.productId);
  if (selfId && ids.includes(selfId)) throw unprocessable("PACKAGE_SELF_REFERENCE", "A package cannot contain itself", "components");
  if (ids.length && (await tx.product.count({ where: { id: { in: ids }, type: { not: "PACKAGE" } } })) !== new Set(ids).size)
    throw unprocessable("INVALID_COMPONENT", "Components must be existing non-package products", "components");
}

export async function saveProduct(ctx: Ctx, input: z.infer<typeof productSchema>, id?: string) {
  authorize(ctx, "product:write");
  return ctx.db.$transaction(async (tx) => {
    await checkProductRefs(tx, input, id);
    const data = productData(input);
    const before = id ? await tx.product.findUniqueOrThrow({ where: { id } }) : null;
    const p = id ? await tx.product.update({ where: { id }, data }) : await tx.product.create({ data: { ...data, tenantId: ctx.tenant.id } });
    await tx.productComponent.deleteMany({ where: { packageProductId: p.id } });
    if (input.components.length)
      await tx.productComponent.createMany({ data: input.components.map((c) => ({ tenantId: ctx.tenant.id, packageProductId: p.id, componentProductId: c.productId, quantity: c.quantity })) });
    const changes = diff(before ?? {}, { ...data, components: input.components });
    if (changes) await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: id ? "product.updated" : "product.created", entityType: "Product", entityId: p.id, changes });
    return p;
  });
}
