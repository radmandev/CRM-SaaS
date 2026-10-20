import { tenantRoute, created } from "@/server/api";
import { commissionRuleSchema } from "@/lib/schemas-travel";
import { addCommissionRule } from "@/modules/suppliers/service";

export const POST = tenantRoute({ permission: "supplier:write", body: commissionRuleSchema }, async ({ ctx, params, body }) => created({ data: await addCommissionRule(ctx, params.id, body) }));
