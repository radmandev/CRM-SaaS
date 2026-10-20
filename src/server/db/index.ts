import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { env } from "../env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function client(): PrismaClient {
  // Created on first use (not at import) so `next build` never needs DATABASE_URL. Cached on globalThis for dev HMR.
  return (globalForPrisma.prisma ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: env().DATABASE_URL }) }));
}

/** Unscoped client. Only for global tables (User, Session, Plan, Job, ...) and code that has no tenant yet. */
export const prisma = new Proxy({} as PrismaClient, {
  get: (_, prop) => {
    const c = client();
    const value = Reflect.get(c, prop);
    return typeof value === "function" ? value.bind(c) : value;
  },
});

/** Every model with a tenantId column that tenant code reads or writes. A test keeps this in sync with the schema. */
export const TENANT_MODELS = new Set<string>([
  "Branch",
  "Membership",
  "MembershipBranch",
  "Invitation",
  "TaxRate",
  "ExchangeRate",
  "NumberSequence",
  "Document",
  "AuditLog",
  "IdempotencyKey",
  "Customer",
  "CustomerContact",
  "Traveler",
  "TravelDocument",
  "Interaction",
  "Tag",
  "CustomerTag",
  "Supplier",
  "SupplierContact",
  "CommissionRule",
  "Product",
  "ProductComponent",
  "Booking",
  "BookingItem",
  "BookingPassenger",
  "BookingItemPassenger",
  "BookingStatusHistory",
  "BookingItemCancellation",
  "BookingAmendment",
  "ItineraryNote",
]);

export class TenantScopeViolation extends Error {}

type Args = { where?: Record<string, unknown>; data?: unknown; create?: Record<string, unknown> };

function scopeWhere(args: Args, field: string, tenantId: string) {
  const given = args.where?.[field];
  if (given !== undefined && given !== tenantId) throw new TenantScopeViolation(`${field} mismatch`);
  args.where = { ...args.where, [field]: tenantId };
}

function scopeData(data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => scopeData(d, tenantId));
  const row = data as Record<string, unknown>;
  if (row.tenantId !== undefined && row.tenantId !== tenantId) throw new TenantScopeViolation("tenantId mismatch");
  return { ...row, tenantId };
}

/**
 * Tenant-scoped client (TEN-03). Injects tenantId into every where/data on tenant-owned models and
 * throws if a caller supplies another tenant's id. `Tenant` itself is pinned to the current tenant.
 * Relations reached through `include` are safe because tenant-to-tenant FKs are composite (TEN-05).
 */
export function tenantDb(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const a = (args ?? {}) as Args;
          if (model === "Tenant") {
            if (operation.startsWith("create") || operation.startsWith("delete") || operation === "upsert")
              throw new TenantScopeViolation(`Tenant.${operation} is not allowed through tenantDb`);
            scopeWhere(a, "id", tenantId);
            return query(a);
          }
          if (!TENANT_MODELS.has(model)) return query(a);
          if (operation === "create" || operation === "createMany" || operation === "createManyAndReturn") {
            a.data = scopeData(a.data, tenantId);
          } else if (operation === "upsert") {
            scopeWhere(a, "tenantId", tenantId);
            a.create = scopeData(a.create, tenantId) as Record<string, unknown>;
          } else {
            scopeWhere(a, "tenantId", tenantId);
            if (operation.startsWith("update") && a.data) {
              const d = a.data as Record<string, unknown>;
              if (d.tenantId !== undefined && d.tenantId !== tenantId) throw new TenantScopeViolation("cannot move rows between tenants");
            }
          }
          return query(a);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
/** Transaction client of a tenantDb, as received inside `tenantDb(id).$transaction(async (tx) => ...)`. */
export type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

export { Prisma };
