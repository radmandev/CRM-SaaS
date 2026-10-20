import { tenantRoute, created } from "@/server/api";
import { travelerSchema } from "@/lib/schemas-travel";
import { createTraveler } from "@/modules/crm/service";

export const POST = tenantRoute({ permission: "customer:write", body: travelerSchema }, async ({ ctx, params, body }) => created({ data: await createTraveler(ctx, params.id, body) }));
