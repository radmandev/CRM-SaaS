import { tenantRoute, created } from "@/server/api";
import { amendmentSchema } from "@/lib/schemas-travel";
import { createAmendment } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "booking:amend", body: amendmentSchema, idempotent: true }, async ({ ctx, params, body }) => created({ data: await createAmendment(ctx, params.id, body) }));
