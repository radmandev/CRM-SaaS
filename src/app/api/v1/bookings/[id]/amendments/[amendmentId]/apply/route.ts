import { tenantRoute } from "@/server/api";
import { applyAmendment } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "booking:amend" }, async ({ ctx, params }) => ({ data: await applyAmendment(ctx, params.id, params.amendmentId) }));
