import { tenantRoute } from "@/server/api";
import { numberingSchema } from "@/lib/schemas";
import { getNumbering, updateNumbering } from "@/modules/tenancy/service";

export const GET = tenantRoute({}, async ({ ctx }) => ({ data: await getNumbering(ctx.db, ctx.tenant.id) }));
export const PATCH = tenantRoute({ permission: "tenant:settings", body: numberingSchema }, async ({ ctx, body }) => ({ data: await updateNumbering(ctx, body) }));
