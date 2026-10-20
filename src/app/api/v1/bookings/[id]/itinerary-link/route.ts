import { tenantRoute } from "@/server/api";
import { createItineraryLink } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "booking:read" }, async ({ ctx, params }) => ({ data: await createItineraryLink(ctx, params.id) }));
