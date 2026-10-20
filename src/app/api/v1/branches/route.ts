import { z } from "zod";
import { tenantRoute, created } from "@/server/api";
import { branchSchema, listQuery } from "@/lib/schemas";
import { createBranch, listBranches } from "@/modules/settings/service";

const query = listQuery.extend({ includeArchived: z.enum(["true", "false"]).transform((v) => v === "true").optional() });

export const GET = tenantRoute({ query }, async ({ ctx, query }) => listBranches(ctx, query));
export const POST = tenantRoute({ permission: "branch:manage", body: branchSchema }, async ({ ctx, body }) => created({ data: await createBranch(ctx, body) }));
