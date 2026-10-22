import { z } from "zod";
import { tenantRoute, created } from "@/server/api";
import { listQuery } from "@/lib/schemas";
import { paymentSchema } from "@/lib/schemas-finance";
import { listPayments, recordPayment } from "@/modules/finance/payments";

const query = listQuery.extend({ customerId: z.uuid().optional(), bookingId: z.uuid().optional() });
export const GET = tenantRoute({ permission: "invoice:read", query }, async ({ ctx, query }) => listPayments(ctx, query));
export const POST = tenantRoute({ permission: "payment:record", body: paymentSchema, idempotent: true }, async ({ ctx, body }) => created({ data: await recordPayment(ctx, body) }));
