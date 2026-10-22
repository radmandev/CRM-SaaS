import { tenantRoute } from "@/server/api";
import { downloadDocument } from "@/modules/documents/service";

// DOC-07: permission on the owning record is checked before any bytes leave storage.
export const GET = tenantRoute({}, async ({ ctx, params }) => {
  const d = await downloadDocument(ctx, params.id);
  return new Response(Buffer.from(d.body), {
    headers: {
      "content-type": d.mimeType,
      "content-disposition": `attachment; filename="${encodeURIComponent(d.filename)}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
