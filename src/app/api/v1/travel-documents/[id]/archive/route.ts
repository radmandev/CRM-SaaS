import { tenantRoute } from "@/server/api";
import { archiveTravelDocument } from "@/modules/crm/service";

export const POST = tenantRoute({ permission: "traveldoc:read" }, async ({ ctx, params }) => archiveTravelDocument(ctx, params.id));
