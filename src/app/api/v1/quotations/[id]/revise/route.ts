import { tenantRoute, created } from "@/server/api";
import { reviseQuotation } from "@/modules/sales/service";

export const POST = tenantRoute({ permission: "quotation:write" }, async ({ ctx, params }) => created({ data: await reviseQuotation(ctx, params.id) }));
