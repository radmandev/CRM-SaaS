import { tenantRoute } from "@/server/api";
import { cancelItemSchema } from "@/lib/schemas-travel";
import { cancelItem } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "booking:cancel", body: cancelItemSchema }, async ({ ctx, params, body }) => ({ data: await cancelItem(ctx, params.id, params.itemId, body) }));
