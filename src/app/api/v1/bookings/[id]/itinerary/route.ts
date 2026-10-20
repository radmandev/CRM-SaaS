import { tenantRoute } from "@/server/api";
import { getItinerary } from "@/modules/bookings/service";

export const GET = tenantRoute({ permission: "booking:read" }, async ({ ctx, params }) => ({ data: await getItinerary(ctx, params.id) }));
