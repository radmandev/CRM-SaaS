import { tenantRoute } from "@/server/api";
import { cancelRefund } from "@/modules/finance/payments";

export const POST = tenantRoute({ permission: "refund:request" }, async ({ ctx, params }) => cancelRefund(ctx, params.id));
