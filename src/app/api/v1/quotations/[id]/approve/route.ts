import { tenantRoute } from "@/server/api";
import { approveQuotation } from "@/modules/sales/service";

export const POST = tenantRoute({ permission: "quotation:approve-discount" }, async ({ ctx, params }) => approveQuotation(ctx, params.id));
