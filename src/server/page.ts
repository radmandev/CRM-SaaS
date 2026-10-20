import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveTenant, resolveUser, type Ctx } from "./context";
import { isLocale, negotiateLocale, translator, type Locale } from "@/lib/i18n";

// Request-scoped helpers for Server Components. Same context resolution as the API (§22.1 API-02).

export const pageUser = cache(async () => resolveUser(await headers()));

export const pageCtx = cache(async (): Promise<Ctx> => {
  const u = await pageUser();
  if (!u) redirect("/login");
  const ctx = await resolveTenant(u);
  if (!ctx) redirect("/no-access");
  return ctx;
});

export const pageLocale = cache(async (): Promise<Locale> => {
  const u = await pageUser().catch(() => null);
  if (u) return u.user.locale;
  const cookie = (await cookies()).get("locale")?.value;
  if (isLocale(cookie)) return cookie;
  return negotiateLocale((await headers()).get("accept-language"));
});

export async function pageT() {
  const locale = await pageLocale();
  return { locale, t: translator(locale) };
}
