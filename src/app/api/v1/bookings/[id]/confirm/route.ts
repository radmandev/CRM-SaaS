import { tenantRoute } from "@/server/api";
import { versionSchema } from "@/lib/schemas-travel";
import { confirmBooking } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "booking:write", body: versionSchema }, async ({ ctx, params, body }) => ({ data: await confirmBooking(ctx, params.id, body.version) }));
