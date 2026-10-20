import { tenantRoute, created } from "@/server/api";
import { taxRateSchema } from "@/lib/schemas";
import { createTaxRate, listTaxRates } from "@/modules/settings/service";

export const GET = tenantRoute({}, async ({ ctx }) => listTaxRates(ctx));
export const POST = tenantRoute({ permission: "tenant:settings", body: taxRateSchema }, async ({ ctx, body }) => created({ data: await createTaxRate(ctx, body) }));
