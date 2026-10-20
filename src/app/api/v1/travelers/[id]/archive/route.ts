import { tenantRoute } from "@/server/api";
import { archiveTraveler } from "@/modules/crm/service";

export const POST = tenantRoute({ permission: "customer:write" }, async ({ ctx, params }) => archiveTraveler(ctx, params.id));
