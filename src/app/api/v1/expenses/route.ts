import { z } from "zod";
import { tenantRoute, created } from "@/server/api";
import { listQuery } from "@/lib/schemas";
import { expenseSchema } from "@/lib/schemas-finance";
import { listExpenses, recordExpense } from "@/modules/finance/payables";

const query = listQuery.extend({ status: z.enum(["PENDING_APPROVAL", "RECORDED", "REJECTED", "REVERSED"]).optional() });
export const GET = tenantRoute({ permission: "expense:write", query }, async ({ ctx, query }) => listExpenses(ctx, query));
export const POST = tenantRoute({ permission: "expense:write", body: expenseSchema, idempotent: true }, async ({ ctx, body }) => created({ data: await recordExpense(ctx, body) }));
