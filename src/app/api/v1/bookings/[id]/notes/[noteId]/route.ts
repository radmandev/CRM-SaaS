import { tenantRoute } from "@/server/api";
import { deleteItineraryNote } from "@/modules/bookings/service";

export const DELETE = tenantRoute({ permission: "booking:write" }, async ({ ctx, params }) => deleteItineraryNote(ctx, params.id, params.noteId));
