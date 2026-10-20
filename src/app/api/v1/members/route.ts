import { z } from "zod";
import { tenantRoute } from "@/server/api";
import { listQuery } from "@/lib/schemas";
import { listMembers } from "@/modules/identity/service";

const query = listQuery.extend({ status: z.enum(["ACTIVE", "DEACTIVATED"]).optional() });

export const GET = tenantRoute({ permission: "user:manage", query }, async ({ ctx, query }) => listMembers(ctx, query));
