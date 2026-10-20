import { tenantRoute } from "@/server/api";
import { productSchema } from "@/lib/schemas-travel";
import { getProduct, saveProduct } from "@/modules/suppliers/service";

export const GET = tenantRoute({}, async ({ ctx, params }) => ({ data: await getProduct(ctx, params.id) }));
export const PATCH = tenantRoute({ permission: "product:write", body: productSchema }, async ({ ctx, params, body }) => ({ data: await saveProduct(ctx, body, params.id) }));
