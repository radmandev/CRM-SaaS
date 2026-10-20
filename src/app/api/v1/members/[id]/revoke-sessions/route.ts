import { tenantRoute } from "@/server/api";
import { revokeMemberSessions } from "@/modules/identity/service";

export const POST = tenantRoute({ permission: "user:manage" }, async ({ ctx, params }) => ({ data: await revokeMemberSessions(ctx, params.id) }));
