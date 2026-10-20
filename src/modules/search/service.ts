import { can, type Ctx } from "@/server/context";
import { scopeWhere } from "@/server/scope";

/** Global search (§24.2): customers, bookings (reference, PNR, passenger surname) and suppliers, each within scope. */
export async function globalSearch(ctx: Ctx, q: string) {
  const term = q.trim();
  if (term.length < 2) return { customers: [], bookings: [], suppliers: [] };
  const [customers, bookings, suppliers] = await Promise.all([
    can(ctx, "customer:read")
      ? ctx.db.customer.findMany({
          where: { ...scopeWhere(ctx, "customer:read"), mergedIntoId: null, OR: [{ displayName: { contains: term, mode: "insensitive" } }, { nameAr: { contains: term } }, { code: { contains: term, mode: "insensitive" } }, { phone: { contains: term.replace(/\s/g, "") } }, { email: { contains: term, mode: "insensitive" } }] },
          select: { id: true, code: true, displayName: true, phone: true },
          take: 8,
        })
      : [],
    can(ctx, "booking:read")
      ? ctx.db.booking.findMany({
          where: { ...scopeWhere(ctx, "booking:read"), OR: [{ reference: { contains: term, mode: "insensitive" } }, { items: { some: { pnr: term.toUpperCase() } } }, { passengers: { some: { lastName: { contains: term.toUpperCase() } } } }] },
          select: { id: true, reference: true, status: true, customer: { select: { displayName: true } } },
          orderBy: { createdAt: "desc" },
          take: 8,
        })
      : [],
    can(ctx, "supplier:read")
      ? ctx.db.supplier.findMany({ where: { archivedAt: null, OR: [{ nameEn: { contains: term, mode: "insensitive" } }, { nameAr: { contains: term } }, { code: { contains: term, mode: "insensitive" } }] }, select: { id: true, code: true, nameEn: true, nameAr: true }, take: 5 })
      : [],
  ]);
  return { customers, bookings, suppliers };
}
