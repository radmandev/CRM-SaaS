import { tenantRoute } from "@/server/api";
import { requestDocument } from "@/modules/documents/service";

export const POST = tenantRoute({ permission: "invoice:read" }, async ({ ctx, params }) => ({ data: await requestDocument(ctx, "RECEIPT", params.id) }));
