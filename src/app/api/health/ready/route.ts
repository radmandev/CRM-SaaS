import { databaseReady } from "@/server/db/raw/health";
import { storageReachable } from "@/server/storage";

// §22.8: DB reachable with all migrations applied, storage reachable. No auth, no details beyond booleans.
export async function GET() {
  const checks = { ...(await databaseReady()), storage: await storageReachable() };
  const ok = Object.values(checks).every(Boolean);
  return Response.json({ status: ok ? "ok" : "unavailable", checks }, { status: ok ? 200 : 503 });
}
