import { tenantRoute } from "@/server/api";
import { branchSchema } from "@/lib/schemas";
import { updateBranch } from "@/modules/settings/service";

export const GET = tenantRoute({}, async ({ ctx, params }) => ({ data: await ctx.db.branch.findUniqueOrThrow({ where: { id: params.id } }) }));
export const PATCH = tenantRoute({ permission: "branch:manage", body: branchSchema }, async ({ ctx, params, body }) => ({ data: await updateBranch(ctx, params.id, body) }));
