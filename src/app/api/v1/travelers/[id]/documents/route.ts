import { tenantRoute, created } from "@/server/api";
import { travelDocumentSchema } from "@/lib/schemas-travel";
import { addTravelDocument } from "@/modules/crm/service";

export const POST = tenantRoute({ permission: "traveldoc:read", body: travelDocumentSchema }, async ({ ctx, params, body }) => created({ data: await addTravelDocument(ctx, params.id, body) }));
