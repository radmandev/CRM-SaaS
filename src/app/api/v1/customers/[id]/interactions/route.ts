import { tenantRoute, created } from "@/server/api";
import { interactionSchema } from "@/lib/schemas-travel";
import { logInteraction } from "@/modules/crm/service";

export const POST = tenantRoute({ permission: "customer:write", body: interactionSchema }, async ({ ctx, params, body }) => created({ data: await logInteraction(ctx, params.id, body) }));
