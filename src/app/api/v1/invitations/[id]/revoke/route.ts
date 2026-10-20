import { tenantRoute } from "@/server/api";
import { revokeInvitation } from "@/modules/identity/service";

export const POST = tenantRoute({ permission: "user:invite" }, async ({ ctx, params }) => revokeInvitation(ctx, params.id));
