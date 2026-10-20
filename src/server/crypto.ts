import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { env } from "./env";

// SEC-10: AES-256-GCM per value, format "v1:<keyId>:<nonce b64>:<ciphertext+tag b64>".
// SEC-11: new writes use the active key; any listed key can still decrypt, so keys rotate without downtime.

export function encrypt(plaintext: string): string {
  const { ENCRYPTION_KEYS, ENCRYPTION_ACTIVE_KEY_ID: keyId } = env();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEYS.get(keyId)!, nonce);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `v1:${keyId}:${nonce.toString("base64")}:${body.toString("base64")}`;
}

export function decrypt(value: string): string {
  const [version, keyId, nonce, body] = value.split(":");
  const key = env().ENCRYPTION_KEYS.get(keyId);
  if (version !== "v1" || !key || !nonce || !body) throw new Error("Unreadable ciphertext");
  const data = Buffer.from(body, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64"));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString("utf8");
}

/** True when a value was written with a key other than the active one (rotation job candidate). */
export const needsReencryption = (value: string) => value.split(":")[1] !== env().ENCRYPTION_ACTIVE_KEY_ID;

/** SEC-12 / CRM-08: deterministic keyed hash of a normalized identifier, for lookups without decryption. */
export function lookupHash(value: string): string {
  return createHmac("sha256", env().HMAC_KEY).update(normalizeId(value)).digest("hex");
}

export const normalizeId = (v: string) => v.replace(/[\s-]/g, "").toUpperCase();
export const last4 = (v: string) => normalizeId(v).slice(-4);
export const mask = (l4: string | null | undefined) => (l4 ? `•••••${l4}` : null);
