import { tenantRoute } from "@/server/api";
import { quotationRejectSchema } from "@/lib/schemas-finance";
import { rejectQuotation } from "@/modules/sales/service";

export const POST = tenantRoute({ permission: "quotation:write", body: quotationRejectSchema }, async ({ ctx, params, body }) => rejectQuotation(ctx, params.id, body));
