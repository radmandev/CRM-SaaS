import { tenantRoute } from "@/server/api";
import { invoiceUpdateSchema } from "@/lib/schemas-finance";
import { deleteDraft, getInvoice, updateDraft } from "@/modules/finance/invoices";

export const GET = tenantRoute({ permission: "invoice:read" }, async ({ ctx, params }) => ({ data: await getInvoice(ctx, params.id) }));
export const PATCH = tenantRoute({ permission: "invoice:issue", body: invoiceUpdateSchema }, async ({ ctx, params, body }) => updateDraft(ctx, params.id, body));
export const DELETE = tenantRoute({ permission: "invoice:issue" }, async ({ ctx, params }) => deleteDraft(ctx, params.id));
