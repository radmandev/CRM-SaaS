import { z } from "zod";
import { tenantRoute, created } from "@/server/api";
import { listQuery } from "@/lib/schemas";
import { supplierSchema, SUPPLIER_TYPES } from "@/lib/schemas-travel";
import { createSupplier, listSuppliers } from "@/modules/suppliers/service";

const query = listQuery.extend({ archived: z.enum(["true", "false"]).transform((v) => v === "true").optional(), type: z.enum(SUPPLIER_TYPES).optional() });

export const GET = tenantRoute({ permission: "supplier:read", query }, async ({ ctx, query }) => listSuppliers(ctx, query));
export const POST = tenantRoute({ permission: "supplier:write", body: supplierSchema, idempotent: true }, async ({ ctx, body }) => created({ data: await createSupplier(ctx, body) }));
