import { tenantRoute, created } from "@/server/api";
import { passengerSchema } from "@/lib/schemas-travel";
import { addPassenger } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "booking:write", body: passengerSchema }, async ({ ctx, params, body }) => created({ data: await addPassenger(ctx, params.id, body) }));
