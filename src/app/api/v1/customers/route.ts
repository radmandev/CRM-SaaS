import { tenantRoute, created } from "@/server/api";
import { customerListQuery, customerSchema } from "@/lib/schemas-travel";
import { createCustomer, listCustomers } from "@/modules/crm/service";

export const GET = tenantRoute({ permission: "customer:read", query: customerListQuery }, async ({ ctx, query }) => listCustomers(ctx, query));
export const POST = tenantRoute({ permission: "customer:write", body: customerSchema, idempotent: true }, async ({ ctx, body }) => created({ data: await createCustomer(ctx, body) }));
