import { z } from "zod";
import { tenantRoute, created } from "@/server/api";
import { listQuery } from "@/lib/schemas";
import { supplierBillSchema } from "@/lib/schemas-finance";
import { listBills, recordBill } from "@/modules/finance/payables";

const query = listQuery.extend({ supplierId: z.uuid().optional(), unpaid: z.enum(["true", "false"]).transform((v) => v === "true").optional() });
export const GET = tenantRoute({ permission: "supplier:read", query }, async ({ ctx, query }) => listBills(ctx, query));
export const POST = tenantRoute({ permission: "supplierbill:write", body: supplierBillSchema, idempotent: true }, async ({ ctx, body }) => created({ data: await recordBill(ctx, body) }));
