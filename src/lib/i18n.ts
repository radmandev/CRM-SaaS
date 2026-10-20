import en from "../../messages/en.json";
import ar from "../../messages/ar.json";

// ADR-09: flat catalogs, `{name}` interpolation, plural keys `<key>.<Intl plural category>`.
export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export type MessageKey = keyof typeof en;
export type Translate = (key: MessageKey | (string & {}), vars?: Record<string, string | number>) => string;
type AnyKey = string;

const catalogs: Record<Locale, Record<string, string>> = { en, ar };

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);
export const dir = (locale: Locale) => (locale === "ar" ? "rtl" : "ltr");

export function translator(locale: Locale): Translate {
  const plural = new Intl.PluralRules(locale);
  return (key: AnyKey, vars?: Record<string, string | number>) => {
    let text = catalogs[locale][key] ?? catalogs.en[key];
    if (text === undefined && vars && typeof vars.count === "number") {
      const k = `${key}.${plural.select(vars.count)}`;
      text = catalogs[locale][k] ?? catalogs[locale][`${key}.other`] ?? catalogs.en[`${key}.other`];
    }
    if (text === undefined) return key;
    return vars ? text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m)) : text;
  };
}

/** Pick a supported locale from an Accept-Language header. */
export function negotiateLocale(acceptLanguage: string | null, fallback: Locale = "ar"): Locale {
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0].trim().slice(0, 2).toLowerCase();
    if (isLocale(tag)) return tag;
  }
  return fallback;
}
