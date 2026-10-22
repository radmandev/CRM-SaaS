import { z } from "zod";
import { tenantRoute } from "@/server/api";
import { requestDocument } from "@/modules/documents/service";

const body = z.discriminatedUnion("kind", [z.object({ kind: z.literal("CONFIRMATION") }), z.object({ kind: z.literal("VOUCHER"), itemId: z.uuid() })]);
export const POST = tenantRoute({ permission: "booking:read", body }, async ({ ctx, params, body }) => ({ data: await requestDocument(ctx, body.kind, params.id, body.kind === "VOUCHER" ? body.itemId : undefined) }));
