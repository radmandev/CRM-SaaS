import { tenantRoute, created } from "@/server/api";
import { itineraryNoteSchema } from "@/lib/schemas-travel";
import { addItineraryNote } from "@/modules/bookings/service";

export const POST = tenantRoute({ permission: "booking:write", body: itineraryNoteSchema }, async ({ ctx, params, body }) => created({ data: await addItineraryNote(ctx, params.id, body) }));
