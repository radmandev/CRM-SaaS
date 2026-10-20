import { tenantRoute } from "@/server/api";
import { cancelBookingSchema } from "@/lib/schemas-travel";
import { cancelBooking } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "booking:cancel", body: cancelBookingSchema }, async ({ ctx, params, body }) => ({ data: await cancelBooking(ctx, params.id, body.version, body.reason) }));
