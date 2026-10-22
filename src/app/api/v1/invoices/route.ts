import { z } from "zod";
import { tenantRoute, created } from "@/server/api";
import { listQuery } from "@/lib/schemas";
import { invoiceCreateSchema } from "@/lib/schemas-finance";
import { createInvoice, listInvoices } from "@/modules/finance/invoices";

const query = listQuery.extend({
  kind: z.enum(["INVOICE", "CREDIT_NOTE"]).optional(),
  status: z.enum(["DRAFT", "ISSUED"]).optional(),
  customerId: z.uuid().optional(),
  unpaid: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});
export const GET = tenantRoute({ permission: "invoice:read", query }, async ({ ctx, query }) => listInvoices(ctx, query));
export const POST = tenantRoute({ permission: "invoice:issue", body: invoiceCreateSchema, idempotent: true }, async ({ ctx, body }) => created({ data: await createInvoice(ctx, body) }));
