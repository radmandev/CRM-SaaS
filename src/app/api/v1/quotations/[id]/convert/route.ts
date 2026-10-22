import { tenantRoute, created } from "@/server/api";
import { convertQuotation } from "@/modules/sales/service";

// QT-03: idempotent by design — a second conversion answers 409 ALREADY_CONVERTED.
export const POST = tenantRoute({ permission: "booking:write" }, async ({ ctx, params }) => created({ data: await convertQuotation(ctx, params.id) }));
