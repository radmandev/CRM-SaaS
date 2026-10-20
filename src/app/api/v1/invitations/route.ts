import { tenantRoute, created } from "@/server/api";
import { invitationSchema, listQuery } from "@/lib/schemas";
import { createInvitation, listInvitations } from "@/modules/identity/service";

export const GET = tenantRoute({ permission: "user:invite", query: listQuery }, async ({ ctx, query }) => listInvitations(ctx, query));
export const POST = tenantRoute({ permission: "user:invite", body: invitationSchema }, async ({ ctx, body }) => created({ data: await createInvitation(ctx, body) }));
