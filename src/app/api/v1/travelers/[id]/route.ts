import { tenantRoute } from "@/server/api";
import { travelerSchema } from "@/lib/schemas-travel";
import { updateTraveler } from "@/modules/crm/service";

export const PATCH = tenantRoute({ permission: "customer:write", body: travelerSchema }, async ({ ctx, params, body }) => ({ data: await updateTraveler(ctx, params.id, body) }));
