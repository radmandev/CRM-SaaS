import { z } from "zod";
import { tenantRoute } from "@/server/api";
import { findTravelersByDocument } from "@/modules/crm/service";

// POST keeps the document number out of URLs and access logs (SEC-13).
export const POST = tenantRoute({ permission: "traveldoc:read", body: z.object({ number: z.string().trim().min(3).max(30) }) }, async ({ ctx, body }) => ({ data: await findTravelersByDocument(ctx, body.number) }));
