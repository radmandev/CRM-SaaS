import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ar from "../../messages/ar.json";
import { negotiateLocale, translator } from "@/lib/i18n";

describe("i18n (FR-04, §24.7)", () => {
  it("ships identical keys in Arabic and English with no empty values", () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(ar)) expect(v.trim(), k).not.toBe("");
  });

  it("keeps placeholders consistent between languages", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en)) expect(vars((ar as Record<string, string>)[k]), k).toEqual(vars((en as Record<string, string>)[k]));
  });

  it("interpolates, falls back to the key, and negotiates locale", () => {
    expect(translator("en")("dashboard.trialEnds", { date: "1 Jan" })).toBe("Trial ends 1 Jan");
    expect(translator("ar")("missing.key")).toBe("missing.key");
    expect(negotiateLocale("fr-FR,en;q=0.8")).toBe("en");
    expect(negotiateLocale(null)).toBe("ar");
  });
});
