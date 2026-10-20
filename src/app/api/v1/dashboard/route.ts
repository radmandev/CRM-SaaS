import { tenantRoute } from "@/server/api";
import { getDashboard } from "@/modules/dashboard/service";

export const GET = tenantRoute({}, async ({ ctx }) => ({ data: await getDashboard(ctx) }));
