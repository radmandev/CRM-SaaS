import { tenantRoute } from "@/server/api";
import { contactSchema } from "@/lib/schemas-travel";
import { deleteContact, saveContact } from "@/modules/crm/service";

export const PATCH = tenantRoute({ permission: "customer:write", body: contactSchema }, async ({ ctx, params, body }) => ({ data: await saveContact(ctx, params.id, body, params.contactId) }));
export const DELETE = tenantRoute({ permission: "customer:write" }, async ({ ctx, params }) => deleteContact(ctx, params.id, params.contactId));
