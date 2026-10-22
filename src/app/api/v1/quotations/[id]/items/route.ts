import { tenantRoute, created } from "@/server/api";
import { bookingItemSchema } from "@/lib/schemas-travel";
import { addQuotationItem } from "@/modules/sales/service";

export const POST = tenantRoute({ permission: "quotation:write", body: bookingItemSchema, idempotent: true }, async ({ ctx, params, body }) => created({ data: await addQuotationItem(ctx, params.id, body) }));
