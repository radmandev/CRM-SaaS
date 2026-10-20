import { prisma } from "@/server/db";
import { tenantRoute } from "@/server/api";

export const GET = tenantRoute({}, async () => ({ data: await prisma.airline.findMany({ orderBy: { code: "asc" } }) }));
