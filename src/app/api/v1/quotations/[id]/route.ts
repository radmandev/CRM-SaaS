import { tenantRoute } from "@/server/api";
import { quotationUpdateSchema } from "@/lib/schemas-finance";
import { getQuotation, updateQuotation } from "@/modules/sales/service";

export const GET = tenantRoute({ permission: "quotation:read" }, async ({ ctx, params }) => ({ data: await getQuotation(ctx, params.id) }));
export const PATCH = tenantRoute({ permission: "quotation:write", body: quotationUpdateSchema }, async ({ ctx, params, body }) => updateQuotation(ctx, params.id, body));
