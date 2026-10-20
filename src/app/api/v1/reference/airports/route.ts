import { z } from "zod";
import { prisma } from "@/server/db";
import { tenantRoute } from "@/server/api";

// Global reference data (SVC-03); any signed-in member may look it up.
export const GET = tenantRoute({ query: z.strictObject({ q: z.string().trim().min(2).max(60) }) }, async ({ query }) => {
  const q = query.q;
  const data = await prisma.airport.findMany({
    where: { OR: [{ code: q.toUpperCase() }, { city: { startsWith: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] },
    orderBy: { code: "asc" },
    take: 15,
  });
  return { data };
});
