import { z } from "zod";
import { tenantRoute } from "@/server/api";
import { sendQuotation } from "@/modules/sales/service";

export const POST = tenantRoute({ permission: "quotation:write", body: z.object({ manual: z.boolean().default(false) }) }, async ({ ctx, params, body }) => ({ data: await sendQuotation(ctx, params.id, body.manual) }));
