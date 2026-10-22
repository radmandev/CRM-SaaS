import { tenantRoute } from "@/server/api";
import { itemChangesSchema } from "@/lib/schemas-travel";
import { removeQuotationItem, updateQuotationItem } from "@/modules/sales/service";

export const PATCH = tenantRoute({ permission: "quotation:write", body: itemChangesSchema }, async ({ ctx, params, body }) => updateQuotationItem(ctx, params.id, params.itemId, body));
export const DELETE = tenantRoute({ permission: "quotation:write" }, async ({ ctx, params }) => removeQuotationItem(ctx, params.id, params.itemId));
