import { tenantRoute, created } from "@/server/api";
import { AppError, notFound } from "@/server/errors";
import { getLogo, uploadLogo } from "@/modules/tenancy/service";

export const GET = tenantRoute({}, async ({ ctx }) => {
  const logo = await getLogo(ctx);
  if (!logo) throw notFound();
  return new Response(Buffer.from(logo.body), {
    headers: { "content-type": logo.mimeType, "cache-control": "private, max-age=300", etag: `"${logo.sha256}"`, "x-content-type-options": "nosniff" },
  });
});

export const POST = tenantRoute({ permission: "tenant:settings" }, async ({ req, ctx }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("logo");
  if (!(file instanceof File)) throw new AppError(400, "FILE_REQUIRED", "Attach a logo file");
  return created({ data: await uploadLogo(ctx, file) });
});
