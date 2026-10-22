import { tenantRoute } from "@/server/api";
import { refundDecisionSchema } from "@/lib/schemas-finance";
import { approveRefund } from "@/modules/finance/payments";

export const POST = tenantRoute({ permission: "refund:approve", body: refundDecisionSchema }, async ({ ctx, params, body }) => approveRefund(ctx, params.id, body.note));
