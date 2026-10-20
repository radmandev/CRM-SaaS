import { tenantRoute } from "@/server/api";
import { taxRateSchema } from "@/lib/schemas";
import { updateTaxRate } from "@/modules/settings/service";

export const GET = tenantRoute({}, async ({ ctx, params }) => {
  const r = await ctx.db.taxRate.findUniqueOrThrow({ where: { id: params.id } });
  return { data: { ...r, rate: r.rate.toString() } };
});
export const PATCH = tenantRoute({ permission: "tenant:settings", body: taxRateSchema }, async ({ ctx, params, body }) => ({ data: await updateTaxRate(ctx, params.id, body) }));
