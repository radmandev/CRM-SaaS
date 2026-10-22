import { tenantRoute } from "@/server/api";
import { requestDocument } from "@/modules/documents/service";

export const POST = tenantRoute({ permission: "quotation:read" }, async ({ ctx, params }) => ({ data: await requestDocument(ctx, "QUOTATION", params.id) }));
