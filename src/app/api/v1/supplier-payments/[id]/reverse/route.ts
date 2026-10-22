import { tenantRoute } from "@/server/api";
import { reverseSchema } from "@/lib/schemas-finance";
import { reverseSupplierPayment } from "@/modules/finance/payables";

export const POST = tenantRoute({ permission: "refund:approve", body: reverseSchema }, async ({ ctx, params, body }) => reverseSupplierPayment(ctx, params.id, body.reason));
