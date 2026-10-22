import { tenantRoute } from "@/server/api";
import { financeSettingsSchema } from "@/lib/schemas-finance";
import { getFinanceSettings, updateFinanceSettings } from "@/modules/tenancy/service";

export const GET = tenantRoute({ permission: "tenant:settings" }, async ({ ctx }) => ({ data: await getFinanceSettings(ctx) }));
export const PATCH = tenantRoute({ permission: "tenant:settings", body: financeSettingsSchema }, async ({ ctx, body }) => ({ data: await updateFinanceSettings(ctx, body) }));
