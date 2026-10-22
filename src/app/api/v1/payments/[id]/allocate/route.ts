import { tenantRoute } from "@/server/api";
import { allocationSchema } from "@/lib/schemas-finance";
import { allocateExisting } from "@/modules/finance/payments";

export const POST = tenantRoute({ permission: "payment:record", body: allocationSchema }, async ({ ctx, params, body }) => allocateExisting(ctx, params.id, body));
