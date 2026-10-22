import { z } from "zod";
import { tenantRoute, created } from "@/server/api";
import { listQuery } from "@/lib/schemas";
import { refundRequestSchema } from "@/lib/schemas-finance";
import { listRefunds, requestRefund } from "@/modules/finance/payments";

const query = listQuery.extend({ status: z.enum(["REQUESTED", "APPROVED", "PAID", "REJECTED", "CANCELLED"]).optional() });
export const GET = tenantRoute({ permission: "refund:request", query }, async ({ ctx, query }) => listRefunds(ctx, query));
export const POST = tenantRoute({ permission: "refund:request", body: refundRequestSchema, idempotent: true }, async ({ ctx, body }) => created({ data: await requestRefund(ctx, body) }));
