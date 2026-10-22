import { tenantRoute } from "@/server/api";

export const GET = tenantRoute({ permission: "expense:write" }, async ({ ctx }) => ({ data: await ctx.db.expenseCategory.findMany({ where: { active: true }, orderBy: { nameEn: "asc" } }) }));
