import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// BKG-13 / QT-05: read-only public links. HMAC over "<kind>.<tenantId>.<id>.<exp>", expiring; no data in the URL
// beyond ids. A link for one kind can never open another kind.

const sign = (kind: string, payload: string) => createHmac("sha256", env().HMAC_KEY).update(`${kind}:${payload}`).digest("base64url");

export function createLink(kind: "itinerary" | "proposal", tenantId: string, id: string, ttlDays: number) {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86_400;
  const payload = `${tenantId}.${id}.${exp}`;
  return { token: `${Buffer.from(payload).toString("base64url")}.${sign(kind, payload)}`, expiresAt: new Date(exp * 1000) };
}

export function verifyLink(kind: "itinerary" | "proposal", token: string): { tenantId: string; id: string } | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = Buffer.from(sign(kind, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [tenantId, id, exp] = payload.split(".");
  if (!tenantId || !id || Number(exp) * 1000 < Date.now()) return null;
  return { tenantId, id };
}
