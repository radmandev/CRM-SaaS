import { tenantRoute } from "@/server/api";
import { setSupplierArchived } from "@/modules/suppliers/service";

export const POST = tenantRoute({ permission: "supplier:write" }, async ({ ctx, params }) => setSupplierArchived(ctx, params.id, true));
