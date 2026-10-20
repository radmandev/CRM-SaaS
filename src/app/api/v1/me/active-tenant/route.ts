import { userRoute } from "@/server/api";
import { activeTenantSchema } from "@/lib/schemas";
import { switchTenant } from "@/modules/identity/service";

export const POST = userRoute({ body: activeTenantSchema }, async ({ ctx, body }) => ({ data: await switchTenant(ctx, body.tenantId) }));
