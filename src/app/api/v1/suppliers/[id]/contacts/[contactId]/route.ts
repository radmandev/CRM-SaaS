import { tenantRoute } from "@/server/api";
import { supplierContactSchema } from "@/lib/schemas-travel";
import { deleteSupplierContact, saveSupplierContact } from "@/modules/suppliers/service";

export const PATCH = tenantRoute({ permission: "supplier:write", body: supplierContactSchema }, async ({ ctx, params, body }) => ({ data: await saveSupplierContact(ctx, params.id, body, params.contactId) }));
export const DELETE = tenantRoute({ permission: "supplier:write" }, async ({ ctx, params }) => deleteSupplierContact(ctx, params.id, params.contactId));
