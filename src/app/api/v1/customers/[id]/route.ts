import { tenantRoute } from "@/server/api";
import { customerUpdateSchema } from "@/lib/schemas-travel";
import { getCustomer, updateCustomer } from "@/modules/crm/service";

export const GET = tenantRoute({ permission: "customer:read" }, async ({ ctx, params }) => ({ data: await getCustomer(ctx, params.id) }));
export const PATCH = tenantRoute({ permission: "customer:write", body: customerUpdateSchema }, async ({ ctx, params, body }) => ({ data: await updateCustomer(ctx, params.id, body) }));
