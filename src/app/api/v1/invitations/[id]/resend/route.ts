import { tenantRoute } from "@/server/api";
import { resendInvitation } from "@/modules/identity/service";

export const POST = tenantRoute({ permission: "user:invite" }, async ({ ctx, params }) => ({ data: await resendInvitation(ctx, params.id) }));
