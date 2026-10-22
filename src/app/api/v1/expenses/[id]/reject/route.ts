import { tenantRoute } from "@/server/api";
import { decideExpense } from "@/modules/finance/payables";

export const POST = tenantRoute({ permission: "refund:approve" }, async ({ ctx, params }) => decideExpense(ctx, params.id, false));
