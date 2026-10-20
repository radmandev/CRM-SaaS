import { tenantRoute, created } from "@/server/api";
import { supplierContactSchema } from "@/lib/schemas-travel";
import { saveSupplierContact } from "@/modules/suppliers/service";

export const POST = tenantRoute({ permission: "supplier:write", body: supplierContactSchema }, async ({ ctx, params, body }) => created({ data: await saveSupplierContact(ctx, params.id, body) }));
