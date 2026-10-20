import { tenantRoute } from "@/server/api";
import { revealTravelDocument } from "@/modules/crm/service";

export const POST = tenantRoute({ permission: "traveldoc:read" }, async ({ ctx, params }) => {
  const data = await revealTravelDocument(ctx, params.id);
  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
});
