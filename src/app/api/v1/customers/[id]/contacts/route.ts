import { tenantRoute, created } from "@/server/api";
import { contactSchema } from "@/lib/schemas-travel";
import { saveContact } from "@/modules/crm/service";

export const POST = tenantRoute({ permission: "customer:write", body: contactSchema }, async ({ ctx, params, body }) => created({ data: await saveContact(ctx, params.id, body) }));
