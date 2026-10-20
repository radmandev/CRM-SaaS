import { tenantRoute } from "@/server/api";
import { mergeSchema } from "@/lib/schemas-travel";
import { mergeCustomers } from "@/modules/crm/service";

export const POST = tenantRoute({ permission: "customer:write", body: mergeSchema }, async ({ ctx, params, body }) => ({ data: await mergeCustomers(ctx, params.id, body.intoCustomerId) }));
