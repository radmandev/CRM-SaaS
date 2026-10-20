import { userRoute } from "@/server/api";
import { resolveTenant } from "@/server/context";
import { profileSchema } from "@/lib/schemas";
import { me, updateProfile } from "@/modules/identity/service";

export const GET = userRoute({}, async ({ ctx }) => ({ data: await me(ctx, await resolveTenant(ctx)) }));

export const PATCH = userRoute({ body: profileSchema }, async ({ ctx, body }) => {
  const user = await updateProfile(ctx, body);
  const res = Response.json({ data: user });
  res.headers.append("set-cookie", `locale=${body.locale}; Path=/; Max-Age=31536000; SameSite=Lax`);
  return res;
});
