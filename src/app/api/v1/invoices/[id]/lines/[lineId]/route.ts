import { tenantRoute } from "@/server/api";
import { removeDraftLine } from "@/modules/finance/invoices";

export const DELETE = tenantRoute({ permission: "invoice:issue" }, async ({ ctx, params }) => removeDraftLine(ctx, params.id, params.lineId));
