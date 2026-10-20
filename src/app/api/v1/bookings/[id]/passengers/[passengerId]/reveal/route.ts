import { tenantRoute } from "@/server/api";
import { revealPassengerDocument } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "traveldoc:read" }, async ({ ctx, params }) =>
  Response.json({ data: await revealPassengerDocument(ctx, params.id, params.passengerId) }, { headers: { "cache-control": "no-store" } }),
);
