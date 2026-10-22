import { tenantRoute } from "@/server/api";
import { approveBooking } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "quotation:approve-discount" }, async ({ ctx, params }) => ({ data: await approveBooking(ctx, params.id) }));
