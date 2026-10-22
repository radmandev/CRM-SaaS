import { tenantRoute } from "@/server/api";
import { refundPaidSchema } from "@/lib/schemas-finance";
import { markRefundPaid } from "@/modules/finance/payments";

export const POST = tenantRoute({ permission: "refund:approve", body: refundPaidSchema }, async ({ ctx, params, body }) => markRefundPaid(ctx, params.id, body));
