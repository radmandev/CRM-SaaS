import { tenantRoute } from "@/server/api";
import { notFound } from "@/server/errors";
import { scopeWhere } from "@/server/scope";
import { customerBalances } from "@/modules/finance/common";

export const GET = tenantRoute({ permission: "invoice:read" }, async ({ ctx, params }) => {
  if (!(await ctx.db.customer.count({ where: { id: params.id, ...scopeWhere(ctx, "customer:read") } }))) throw notFound();
  return { data: (await customerBalances(ctx.db, params.id)).map((b) => ({ ...b, invoiced: b.invoiced.toFixed(2), credited: b.credited.toFixed(2), paid: b.paid.toFixed(2), refunded: b.refunded.toFixed(2), balance: b.balance.toFixed(2) })) };
});
