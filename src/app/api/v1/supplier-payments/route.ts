import { z } from "zod";
import { tenantRoute, created } from "@/server/api";
import { listQuery } from "@/lib/schemas";
import { supplierPaymentSchema } from "@/lib/schemas-finance";
import { listSupplierPayments, recordSupplierPayment } from "@/modules/finance/payables";

const query = listQuery.extend({ supplierId: z.uuid().optional() });
export const GET = tenantRoute({ permission: "supplier:read", query }, async ({ ctx, query }) => listSupplierPayments(ctx, query));
export const POST = tenantRoute({ permission: "supplierpayment:write", body: supplierPaymentSchema, idempotent: true }, async ({ ctx, body }) => created({ data: await recordSupplierPayment(ctx, body) }));
