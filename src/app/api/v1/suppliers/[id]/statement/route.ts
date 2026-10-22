import { tenantRoute } from "@/server/api";
import { statementQuery } from "@/lib/schemas-finance";
import { currency } from "@/lib/schemas";
import { supplierStatement } from "@/modules/finance/reports";

export const GET = tenantRoute({ permission: "supplier:read", query: statementQuery.extend({ currency: currency.default("SAR") }) }, async ({ ctx, params, query }) => ({ data: await supplierStatement(ctx, params.id, query.from, query.to, query.currency) }));
