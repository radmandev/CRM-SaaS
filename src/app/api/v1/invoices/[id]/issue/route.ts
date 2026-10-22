import { tenantRoute } from "@/server/api";
import { issueInvoice } from "@/modules/finance/invoices";

// Concurrency-safe by design: the draft row is locked and numbers come from a locked sequence (NUM-02).
export const POST = tenantRoute({ permission: "invoice:issue" }, async ({ ctx, params }) => ({ data: await issueInvoice(ctx, params.id) }));
