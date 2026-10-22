import { tenantRoute, created } from "@/server/api";
import { invoiceLineSchema } from "@/lib/schemas-finance";
import { addDraftLine } from "@/modules/finance/invoices";

export const POST = tenantRoute({ permission: "invoice:issue", body: invoiceLineSchema }, async ({ ctx, params, body }) => created({ data: await addDraftLine(ctx, params.id, body) }));
