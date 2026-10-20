import { tenantRoute } from "@/server/api";
import { bookingUpdateSchema } from "@/lib/schemas-travel";
import { getBooking, updateBooking } from "@/modules/bookings/service";

export const GET = tenantRoute({ permission: "booking:read" }, async ({ ctx, params }) => ({ data: await getBooking(ctx, params.id) }));
export const PATCH = tenantRoute({ permission: "booking:write", body: bookingUpdateSchema }, async ({ ctx, params, body }) => ({ data: await updateBooking(ctx, params.id, body) }));
