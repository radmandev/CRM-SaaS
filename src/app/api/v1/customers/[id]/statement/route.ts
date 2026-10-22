import { tenantRoute } from "@/server/api";
import { statementQuery } from "@/lib/schemas-finance";
import { currency } from "@/lib/schemas";
import { customerStatement } from "@/modules/finance/reports";

export const GET = tenantRoute({ permission: "invoice:read", query: statementQuery.extend({ currency: currency.default("SAR") }) }, async ({ ctx, params, query }) => ({ data: await customerStatement(ctx, params.id, query.from, query.to, query.currency) }));
