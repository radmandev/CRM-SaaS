import { tenantRoute } from "@/server/api";
import { itemPassengersSchema } from "@/lib/schemas-travel";
import { setItemPassengers } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "booking:write", body: itemPassengersSchema }, async ({ ctx, params, body }) => setItemPassengers(ctx, params.id, params.itemId, body.passengerIds));
