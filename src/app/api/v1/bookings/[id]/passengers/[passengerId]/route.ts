import { tenantRoute } from "@/server/api";
import { removePassenger } from "@/modules/bookings/service";

export const DELETE = tenantRoute({ permission: "booking:write" }, async ({ ctx, params }) => removePassenger(ctx, params.id, params.passengerId));
