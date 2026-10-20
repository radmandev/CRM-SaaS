import { z } from "zod";
import { publicRoute } from "@/server/api";
import { lookupInvitation } from "@/modules/identity/service";

// POST so the token stays out of URLs and access logs.
export const POST = publicRoute({ body: z.object({ token: z.string().min(1).max(512) }) }, async ({ body }) => ({ data: await lookupInvitation(body.token) }));
