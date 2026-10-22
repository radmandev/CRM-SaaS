import { tenantRoute } from "@/server/api";
import { quotationAcceptSchema } from "@/lib/schemas-finance";
import { acceptQuotation } from "@/modules/sales/service";

export const POST = tenantRoute({ permission: "quotation:write", body: quotationAcceptSchema }, async ({ ctx, params, body }) => acceptQuotation(ctx, params.id, body));
