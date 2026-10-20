import { tenantRoute } from "@/server/api";
import { itemStatusSchema } from "@/lib/schemas-travel";
import { changeItemStatus } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "booking:write", body: itemStatusSchema }, async ({ ctx, params, body }) => ({ data: await changeItemStatus(ctx, params.id, params.itemId, body) }));
