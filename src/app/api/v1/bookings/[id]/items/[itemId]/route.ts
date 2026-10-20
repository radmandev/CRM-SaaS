import { tenantRoute } from "@/server/api";
import { itemChangesSchema } from "@/lib/schemas-travel";
import { deleteItem, updateItem } from "@/modules/bookings/service";

export const PATCH = tenantRoute({ permission: "booking:write", body: itemChangesSchema }, async ({ ctx, params, body }) => ({ data: await updateItem(ctx, params.id, params.itemId, body) }));
export const DELETE = tenantRoute({ permission: "booking:write" }, async ({ ctx, params }) => deleteItem(ctx, params.id, params.itemId));
