import { tenantRoute } from "@/server/api";
import { cancelAmendment } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "booking:amend" }, async ({ ctx, params }) => cancelAmendment(ctx, params.id, params.amendmentId));
