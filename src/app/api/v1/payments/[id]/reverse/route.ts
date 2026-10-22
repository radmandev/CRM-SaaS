import { tenantRoute } from "@/server/api";
import { reverseSchema } from "@/lib/schemas-finance";
import { reversePayment } from "@/modules/finance/payments";

export const POST = tenantRoute({ permission: "refund:approve", body: reverseSchema }, async ({ ctx, params, body }) => reversePayment(ctx, params.id, body.reason));
