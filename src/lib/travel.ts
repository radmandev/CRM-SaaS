// Travel identifiers shared by forms and services (CRM-06, CRM-09, BKG-05, §9.1). Pure functions.

export const PASSPORT_RE = /^[A-Z0-9]{5,20}$/;
export const SAUDI_ID_RE = /^1\d{9}$/;
export const IQAMA_RE = /^2\d{9}$/;
export const TICKET_RE = /^\d{13}$/;
export const IATA_AIRPORT_RE = /^[A-Z]{3}$/;
export const IATA_AIRLINE_RE = /^[A-Z0-9]{2}$/;

export type DocType = "PASSPORT" | "NATIONAL_ID" | "IQAMA" | "VISA" | "OTHER";

export function validDocumentNumber(type: DocType, raw: string): boolean {
  const n = raw.replace(/[\s-]/g, "").toUpperCase();
  if (type === "NATIONAL_ID") return SAUDI_ID_RE.test(n);
  if (type === "IQAMA") return IQAMA_RE.test(n);
  if (type === "PASSPORT") return PASSPORT_RE.test(n);
  return /^[A-Z0-9]{3,30}$/.test(n);
}

/** ISO 13616 IBAN check (mod 97). */
export function validIban(raw: string): boolean {
  const iban = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith("SA") && iban.length !== 24) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

/** CRM-06: passenger type from date of birth at the travel date. */
export function paxType(dateOfBirth: string | null | undefined, travelDate: string): "ADT" | "CHD" | "INF" {
  if (!dateOfBirth) return "ADT";
  const [by, bm, bd] = dateOfBirth.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = travelDate.slice(0, 10).split("-").map(Number);
  const age = ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
  return age < 2 ? "INF" : age < 12 ? "CHD" : "ADT";
}

/** CRM-10: does the document expire within `months` after `date`? */
export function expiresWithin(expiry: string, date: string, months = 6): boolean {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return new Date(`${expiry.slice(0, 10)}T00:00:00Z`) < d;
}
