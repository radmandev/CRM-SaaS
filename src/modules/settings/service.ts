import type { z } from "zod";
import { audit, diff } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { unprocessable } from "@/server/errors";
import { assertWithinLimit } from "@/server/plan";
import { after, page } from "@/server/pagination";
import type { branchSchema, exchangeRateSchema, listQuery, taxRateSchema } from "@/lib/schemas";

type List = z.infer<typeof listQuery>;

// ───────── Branches (§5.4) ─────────

export async function listBranches(ctx: Ctx, q: List & { includeArchived?: boolean }) {
  const rows = await ctx.db.branch.findMany({
    where: {
      ...(q.includeArchived ? {} : { archivedAt: null }),
      ...(q.q ? { OR: [{ code: { contains: q.q, mode: "insensitive" } }, { nameEn: { contains: q.q, mode: "insensitive" } }, { nameAr: { contains: q.q } }] } : {}),
      ...after(q.cursor, "code", "asc"),
    },
    orderBy: [{ code: "asc" }, { id: "asc" }],
    take: q.limit + 1,
  });
  return page(rows, q.limit, (r) => r.code);
}

export async function createBranch(ctx: Ctx, input: z.infer<typeof branchSchema>) {
  authorize(ctx, "branch:manage");
  return ctx.db.$transaction(async (tx) => {
    await assertWithinLimit(tx, ctx.tenant.id, ctx.tenant.planId, "branches"); // BR-04
    const branch = await tx.branch.create({ data: { ...input, tenantId: ctx.tenant.id } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "branch.created", entityType: "Branch", entityId: branch.id, changes: diff({}, input) });
    return branch;
  });
}

export async function updateBranch(ctx: Ctx, id: string, input: z.infer<typeof branchSchema>) {
  authorize(ctx, "branch:manage");
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.branch.findUniqueOrThrow({ where: { id } });
    const branch = await tx.branch.update({ where: { id }, data: input });
    const changes = diff(before, input);
    if (changes) await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "branch.updated", entityType: "Branch", entityId: id, changes });
    return branch;
  });
}

export async function setBranchArchived(ctx: Ctx, id: string, archived: boolean) {
  authorize(ctx, "branch:manage");
  return ctx.db.$transaction(async (tx) => {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id } });
    if (archived && !branch.archivedAt) {
      // BR-01: keep at least one active branch. BR-03 (open bookings/invoices) applies once those exist (Phase 2-3).
      if ((await tx.branch.count({ where: { archivedAt: null } })) <= 1) throw unprocessable("LAST_BRANCH", "An agency needs at least one active branch");
      if (await tx.membership.count({ where: { primaryBranchId: id, status: "ACTIVE" } }))
        throw unprocessable("BRANCH_IN_USE", "Move members whose primary branch this is before archiving it");
    }
    if (!archived && branch.archivedAt) await assertWithinLimit(tx, ctx.tenant.id, ctx.tenant.planId, "branches");
    const updated = await tx.branch.update({ where: { id }, data: { archivedAt: archived ? (branch.archivedAt ?? new Date()) : null } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: archived ? "branch.archived" : "branch.restored", entityType: "Branch", entityId: id });
    return updated;
  });
}

// ───────── Tax rates (§5.7) ─────────

export async function listTaxRates(ctx: Ctx) {
  const data = await ctx.db.taxRate.findMany({ orderBy: [{ active: "desc" }, { code: "asc" }] });
  return { data: data.map((r) => ({ ...r, rate: r.rate.toString() })) };
}

const ZATCA_CODE = { STANDARD: "S", ZERO_RATED: "Z", EXEMPT: "E", OUT_OF_SCOPE: "O" } as const;

function checkTaxRate(input: z.infer<typeof taxRateSchema>) {
  if (input.category === "STANDARD" && Number(input.rate) === 0) throw unprocessable("RATE_REQUIRED", "A standard rate must be above zero", "rate");
  if (input.category !== "STANDARD" && Number(input.rate) !== 0) throw unprocessable("RATE_MUST_BE_ZERO", "Only standard rates can be above zero", "rate");
}

export async function createTaxRate(ctx: Ctx, input: z.infer<typeof taxRateSchema>) {
  authorize(ctx, "tenant:settings");
  checkTaxRate(input);
  return ctx.db.$transaction(async (tx) => {
    const r = await tx.taxRate.create({ data: { ...input, tenantId: ctx.tenant.id, zatcaCode: ZATCA_CODE[input.category] } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "tax_rate.created", entityType: "TaxRate", entityId: r.id, changes: diff({}, input) });
    return { ...r, rate: r.rate.toString() };
  });
}

export async function updateTaxRate(ctx: Ctx, id: string, input: z.infer<typeof taxRateSchema>) {
  authorize(ctx, "tenant:settings");
  checkTaxRate(input);
  // ponytail: rates are freely editable until Phase 3; then a rate used on an issued invoice must be versioned, not edited.
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.taxRate.findUniqueOrThrow({ where: { id } });
    const r = await tx.taxRate.update({ where: { id }, data: { ...input, zatcaCode: ZATCA_CODE[input.category] } });
    const changes = diff({ ...before, rate: before.rate.toString() }, input);
    if (changes) await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "tax_rate.updated", entityType: "TaxRate", entityId: id, changes });
    return { ...r, rate: r.rate.toString() };
  });
}

// ───────── Exchange rates (§5.5) ─────────

export async function listExchangeRates(ctx: Ctx, q: List) {
  const rows = await ctx.db.exchangeRate.findMany({
    where: { ...(q.q ? { OR: [{ fromCurrency: q.q.toUpperCase() }, { toCurrency: q.q.toUpperCase() }] } : {}), ...after(q.cursor, "effectiveDate", "desc") },
    orderBy: [{ effectiveDate: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  const p = page(rows, q.limit, (r) => r.effectiveDate);
  return { ...p, data: p.data.map((r) => ({ ...r, rate: r.rate.toString(), effectiveDate: r.effectiveDate.toISOString().slice(0, 10) })) };
}

export async function createExchangeRate(ctx: Ctx, input: z.infer<typeof exchangeRateSchema>) {
  authorize(ctx, "tenant:settings");
  return ctx.db.$transaction(async (tx) => {
    const r = await tx.exchangeRate.create({ data: { ...input, tenantId: ctx.tenant.id, effectiveDate: new Date(input.effectiveDate) } });
    await audit(tx, { tenantId: ctx.tenant.id, actor: ctx.actor, action: "exchange_rate.created", entityType: "ExchangeRate", entityId: r.id, changes: diff({}, input) });
    return { ...r, rate: r.rate.toString(), effectiveDate: input.effectiveDate };
  });
}
