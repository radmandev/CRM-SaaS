import { tenantRoute } from "@/server/api";
import { refundDecisionSchema } from "@/lib/schemas-finance";
import { rejectRefund } from "@/modules/finance/payments";

export const POST = tenantRoute({ permission: "refund:approve", body: refundDecisionSchema }, async ({ ctx, params, body }) => rejectRefund(ctx, params.id, body.note));
