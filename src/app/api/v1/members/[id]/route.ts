import { tenantRoute } from "@/server/api";
import { memberUpdateSchema } from "@/lib/schemas";
import { getMember, updateMember } from "@/modules/identity/service";

export const GET = tenantRoute({ permission: "user:manage" }, async ({ ctx, params }) => ({ data: await getMember(ctx, params.id) }));
export const PATCH = tenantRoute({ permission: "user:manage", body: memberUpdateSchema }, async ({ ctx, params, body }) => ({ data: await updateMember(ctx, params.id, body) }));
