import { tenantRoute } from "@/server/api";
import { sendInvoice } from "@/modules/finance/invoices";

export const POST = tenantRoute({ permission: "invoice:issue" }, async ({ ctx, params }) => ({ data: await sendInvoice(ctx, params.id) }));
