import { tenantRoute, created } from "@/server/api";
import { creditNoteSchema } from "@/lib/schemas-finance";
import { issueCreditNote } from "@/modules/finance/invoices";

export const POST = tenantRoute({ permission: "creditnote:issue", body: creditNoteSchema, idempotent: true }, async ({ ctx, params, body }) => created({ data: await issueCreditNote(ctx, params.id, body) }));
