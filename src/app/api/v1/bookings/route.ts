import { tenantRoute, created } from "@/server/api";
import { bookingCreateSchema, bookingListQuery } from "@/lib/schemas-travel";
import { createBooking, listBookings } from "@/modules/bookings/service";

export const GET = tenantRoute({ permission: "booking:read", query: bookingListQuery }, async ({ ctx, query }) => listBookings(ctx, query));
// BKG-22: duplicate submissions with the same Idempotency-Key create one booking.
export const POST = tenantRoute({ permission: "booking:write", body: bookingCreateSchema, idempotent: true }, async ({ ctx, body }) => created({ data: await createBooking(ctx, body) }));
