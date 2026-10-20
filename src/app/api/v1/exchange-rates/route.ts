import { tenantRoute, created } from "@/server/api";
import { exchangeRateSchema, listQuery } from "@/lib/schemas";
import { createExchangeRate, listExchangeRates } from "@/modules/settings/service";

export const GET = tenantRoute({ query: listQuery }, async ({ ctx, query }) => listExchangeRates(ctx, query));
export const POST = tenantRoute({ permission: "tenant:settings", body: exchangeRateSchema }, async ({ ctx, body }) => created({ data: await createExchangeRate(ctx, body) }));
