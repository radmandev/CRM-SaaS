import { tenantRoute } from "@/server/api";
import { refreshPassengerFromProfile } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "booking:write" }, async ({ ctx, params }) => refreshPassengerFromProfile(ctx, params.id, params.passengerId));
