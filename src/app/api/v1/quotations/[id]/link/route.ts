import { tenantRoute } from "@/server/api";
import { quotationLink } from "@/modules/sales/service";

export const POST = tenantRoute({ permission: "quotation:read" }, async ({ ctx, params }) => ({ data: await quotationLink(ctx, params.id) }));
