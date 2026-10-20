import type { Locale } from "./i18n";

// LOC-02 / LOC-06: timestamps shown in the tenant timezone with Western digits (Latin numbering) by default.
export function formatDateTime(value: Date | string, locale: Locale, timeZone: string, opts: { hijri?: boolean } = {}) {
  const d = typeof value === "string" ? new Date(value) : value;
  const base = new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium", timeStyle: "short", timeZone }).format(d);
  if (!opts.hijri) return base;
  const hijri = new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura-nu-latn`, { dateStyle: "medium", timeZone }).format(d); // LOC-05
  return `${base} (${hijri})`;
}

/** Date-only values (LOC-03) are rendered without timezone conversion. */
export function formatDate(value: Date | string, locale: Locale) {
  const iso = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

export function formatBytes(bytes: number, locale: Locale) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(`${locale}-u-nu-latn`, { maximumFractionDigits: 1 }).format(n)} ${units[i]}`;
}
