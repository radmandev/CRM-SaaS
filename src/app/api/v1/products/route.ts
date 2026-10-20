import { z } from "zod";
import { tenantRoute, created } from "@/server/api";
import { listQuery } from "@/lib/schemas";
import { productSchema, SERVICE_TYPES } from "@/lib/schemas-travel";
import { listProducts, saveProduct } from "@/modules/suppliers/service";

const query = listQuery.extend({ type: z.enum(SERVICE_TYPES).optional(), includeInactive: z.enum(["true", "false"]).transform((v) => v === "true").optional() });

export const GET = tenantRoute({ query }, async ({ ctx, query }) => listProducts(ctx, query));
export const POST = tenantRoute({ permission: "product:write", body: productSchema, idempotent: true }, async ({ ctx, body }) => created({ data: await saveProduct(ctx, body) }));
