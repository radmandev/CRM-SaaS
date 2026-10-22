import { tenantRoute, created } from "@/server/api";
import { transferSchema } from "@/lib/schemas-finance";
import { transfer } from "@/modules/finance/payables";

export const POST = tenantRoute({ permission: "refund:approve", body: transferSchema, idempotent: true }, async ({ ctx, body }) => created({ data: await transfer(ctx, body) }));
