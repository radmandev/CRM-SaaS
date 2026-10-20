import { tenantRoute } from "@/server/api";
import { setCustomerArchived } from "@/modules/crm/service";

export const POST = tenantRoute({ permission: "customer:write" }, async ({ ctx, params }) => setCustomerArchived(ctx, params.id, true));
