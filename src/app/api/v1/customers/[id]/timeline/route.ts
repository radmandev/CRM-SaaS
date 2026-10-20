import { tenantRoute } from "@/server/api";
import { customerTimeline } from "@/modules/crm/service";

export const GET = tenantRoute({ permission: "customer:read" }, async ({ ctx, params }) => ({ data: await customerTimeline(ctx, params.id) }));
