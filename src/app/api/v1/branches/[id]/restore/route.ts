import { tenantRoute } from "@/server/api";
import { setBranchArchived } from "@/modules/settings/service";

export const POST = tenantRoute({ permission: "branch:manage" }, async ({ ctx, params }) => ({ data: await setBranchArchived(ctx, params.id, false) }));
