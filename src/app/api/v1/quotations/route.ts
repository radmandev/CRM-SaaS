import { z } from "zod";
import { tenantRoute, created } from "@/server/api";
import { listQuery } from "@/lib/schemas";
import { quotationCreateSchema } from "@/lib/schemas-finance";
import { createQuotation, listQuotations } from "@/modules/sales/service";

const query = listQuery.extend({ status: z.string().max(30).optional(), customerId: z.uuid().optional() });
export const GET = tenantRoute({ permission: "quotation:read", query }, async ({ ctx, query }) => listQuotations(ctx, query));
export const POST = tenantRoute({ permission: "quotation:write", body: quotationCreateSchema, idempotent: true }, async ({ ctx, body }) => created({ data: await createQuotation(ctx, body) }));
