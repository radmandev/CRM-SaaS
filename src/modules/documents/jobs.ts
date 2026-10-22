import { registerWorkerHandlers } from "@/server/jobs";
import { generateDocument } from "./render";
import { sendDocumentEmail, type DocumentEmail } from "./email";
import type { DocKind } from "./service";

// Imported by the worker (and the tests' job runner) only; see registerWorkerHandlers.
registerWorkerHandlers({
  "pdf.render": async (job) => {
    const p = job.payload as { kind: DocKind; id: string; itemId?: string; userId?: string };
    await generateDocument(job.tenantId!, p.kind, p.id, p.itemId, p.userId);
  },
  "document.email": async (job) => {
    await sendDocumentEmail(job.tenantId!, job.payload as unknown as DocumentEmail);
  },
});
