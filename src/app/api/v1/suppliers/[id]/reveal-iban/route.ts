import { tenantRoute } from "@/server/api";
import { revealSupplierIban } from "@/modules/suppliers/service";

export const POST = tenantRoute({ permission: "supplier:write" }, async ({ ctx, params }) =>
  Response.json({ data: await revealSupplierIban(ctx, params.id) }, { headers: { "cache-control": "no-store" } }),
);
