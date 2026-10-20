import { publicRoute } from "@/server/api";
import { acceptInvitationSchema } from "@/lib/schemas";
import { acceptInvitation } from "@/modules/identity/service";

export const POST = publicRoute({ body: acceptInvitationSchema }, async ({ ctx, body }) => {
  const { headers } = await acceptInvitation(body, ctx);
  const res = Response.json({ data: { accepted: true } });
  for (const cookie of headers?.getSetCookie() ?? []) res.headers.append("set-cookie", cookie);
  return res;
});
