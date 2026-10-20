import { AppError } from "./errors";

// API-05: keyset pagination. The cursor encodes the sort value and id of the last row returned.
type Cursor = { v: string; id: string };

export function decodeCursor(cursor?: string): Cursor | null {
  if (!cursor) return null;
  try {
    const c = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof c?.v === "string" && typeof c?.id === "string") return c;
  } catch {}
  throw new AppError(400, "INVALID_CURSOR", "Invalid cursor");
}

/** Prisma where-fragment continuing after the cursor for `ORDER BY field dir, id dir`. */
export function after(cursor: string | undefined, field: string, dir: "asc" | "desc") {
  const c = decodeCursor(cursor);
  if (!c) return {};
  const op = dir === "desc" ? "lt" : "gt";
  return { OR: [{ [field]: { [op]: c.v } }, { [field]: c.v, id: { [op]: c.id } }] };
}

/** Fetch `limit + 1` rows, then call this to build `{ data, page }`. */
export function page<T extends { id: string }>(rows: T[], limit: number, sortValue: (row: T) => string | Date) {
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  const v = last ? sortValue(last) : null;
  const nextCursor =
    hasMore && last ? Buffer.from(JSON.stringify({ v: v instanceof Date ? v.toISOString() : v, id: last.id })).toString("base64url") : null;
  return { data, page: { nextCursor, hasMore } };
}
