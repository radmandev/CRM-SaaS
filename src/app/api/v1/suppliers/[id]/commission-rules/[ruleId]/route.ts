import { tenantRoute } from "@/server/api";
import { deleteCommissionRule } from "@/modules/suppliers/service";

export const DELETE = tenantRoute({ permission: "supplier:write" }, async ({ ctx, params }) => deleteCommissionRule(ctx, params.id, params.ruleId));
