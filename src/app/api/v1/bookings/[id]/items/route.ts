import { tenantRoute, created } from "@/server/api";
import { bookingItemSchema } from "@/lib/schemas-travel";
import { addItem } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "booking:write", body: bookingItemSchema, idempotent: true }, async ({ ctx, params, body }) => created({ data: await addItem(ctx, params.id, body) }));
