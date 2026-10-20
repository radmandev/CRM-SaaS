import { z } from "zod";
import { tenantRoute } from "@/server/api";
import { globalSearch } from "@/modules/search/service";

export const GET = tenantRoute({ query: z.strictObject({ q: z.string().trim().max(100).default("") }) }, async ({ ctx, query }) => ({ data: await globalSearch(ctx, query.q) }));
