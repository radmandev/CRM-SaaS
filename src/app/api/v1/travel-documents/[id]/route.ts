import { tenantRoute } from "@/server/api";
import { travelDocumentSchema } from "@/lib/schemas-travel";
import { updateTravelDocument } from "@/modules/crm/service";

export const PATCH = tenantRoute({ permission: "traveldoc:read", body: travelDocumentSchema }, async ({ ctx, params, body }) => ({ data: await updateTravelDocument(ctx, params.id, body) }));
