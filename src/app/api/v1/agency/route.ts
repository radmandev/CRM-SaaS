import { tenantRoute } from "@/server/api";
import { agencySchema } from "@/lib/schemas";
import { getAgency, updateAgency } from "@/modules/tenancy/service";

export const GET = tenantRoute({}, async ({ ctx }) => ({ data: await getAgency(ctx) }));
export const PATCH = tenantRoute({ permission: "tenant:settings", body: agencySchema }, async ({ ctx, body }) => ({ data: await updateAgency(ctx, body) }));
