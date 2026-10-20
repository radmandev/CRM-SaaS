import { tenantRoute } from "@/server/api";
import { supplierSchema } from "@/lib/schemas-travel";
import { getSupplier, updateSupplier } from "@/modules/suppliers/service";

export const GET = tenantRoute({ permission: "supplier:read" }, async ({ ctx, params }) => ({ data: await getSupplier(ctx, params.id) }));
export const PATCH = tenantRoute({ permission: "supplier:write", body: supplierSchema }, async ({ ctx, params, body }) => ({ data: await updateSupplier(ctx, params.id, body) }));
