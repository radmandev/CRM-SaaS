import { tenantRoute } from "@/server/api";
import { notFound } from "@/server/errors";
import { REPORTS, reportQuery } from "@/lib/schemas-finance";
import { runReport } from "@/modules/finance/reports";

export const GET = tenantRoute({ permission: "report:financial", query: reportQuery }, async ({ ctx, params, query }) => {
  const name = REPORTS.find((r) => r === params.name);
  if (!name) throw notFound();
  return { data: await runReport(ctx, name, query) };
});
