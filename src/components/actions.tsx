"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { translator, type Locale } from "@/lib/i18n";

async function post(url: string, locale: Locale, body?: unknown, method = "POST") {
  const res = await fetch(url, { method, headers: { "content-type": "application/json", "accept-language": locale }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

/** Button for a single POST action. Destructive actions confirm first and state the consequence (FR-06). */
export function ActionButton({ url, label, confirm, locale, variant = "secondary", body, method = "POST" }: { url: string; label: string; confirm?: string; locale: Locale; variant?: "secondary" | "danger"; body?: unknown; method?: "POST" | "PATCH" }) {
  const t = useMemo(() => translator(locale), [locale]);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className={variant === "danger" ? "btn-danger" : "btn-secondary"}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setPending(true);
          setError(null);
          const { ok, data } = await post(url, locale, body, method).catch(() => ({ ok: false, data: {} as Record<string, string> }));
          setPending(false);
          if (!ok) {
            const known = data.code ? t(`error.${data.code}`) : "";
            setError(known && known !== `error.${data.code}` ? known : data.title || t("error.INTERNAL"));
            return;
          }
          router.refresh();
        }}
      >
        {pending ? t("common.working") : label}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}

export function LogoUpload({ locale, hasLogo }: { locale: Locale; hasLogo: boolean }) {
  const t = useMemo(() => translator(locale), [locale]);
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [version, setVersion] = useState(0);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem("logo") as HTMLInputElement;
        if (!input.files?.[0]) return setMessage({ ok: false, text: t("error.FILE_REQUIRED") });
        const body = new FormData();
        body.set("logo", input.files[0]);
        setPending(true);
        const res = await fetch("/api/v1/agency/logo", { method: "POST", body, headers: { "accept-language": locale } }).catch(() => null);
        const data = res ? await res.json().catch(() => ({})) : {};
        setPending(false);
        if (!res?.ok) return setMessage({ ok: false, text: (data.code && t(`error.${data.code}`)) || t("error.INTERNAL") });
        setMessage({ ok: true, text: t("settings.agency.logoUploaded") });
        setVersion((v) => v + 1);
        router.refresh();
      }}
    >
      {(hasLogo || version > 0) && (
        // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked route; next/image adds nothing here
        <img src={`/api/v1/agency/logo?v=${version}`} alt={t("settings.agency.currentLogo")} className="h-16 w-auto rounded border border-line bg-white p-1" />
      )}
      <div className="space-y-1">
        <label htmlFor="logo" className="block text-sm font-medium">
          {t("settings.agency.logo")}
        </label>
        <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" className="block text-sm" aria-describedby="logo-hint" />
        <p id="logo-hint" className="text-xs text-muted">
          {t("settings.agency.logoHint")}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-secondary" disabled={pending}>
          {pending ? t("common.saving") : t("settings.agency.uploadLogo")}
        </button>
        {message && (
          <span role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}

export function LocaleSwitcher({ locale, loggedIn }: { locale: Locale; loggedIn: boolean }) {
  const router = useRouter();
  const next: Locale = locale === "ar" ? "en" : "ar";
  return (
    <button
      type="button"
      className="btn-ghost"
      lang={next}
      onClick={async () => {
        if (loggedIn) {
          const me = await fetch("/api/v1/me").then((r) => r.json());
          await fetch("/api/v1/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: me.data.user.name, locale: next }) });
        } else {
          document.cookie = `locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
        }
        router.refresh();
      }}
    >
      {next === "ar" ? "العربية" : "English"}
    </button>
  );
}

export function TenantSwitcher({ locale, current, options, label }: { locale: Locale; current: string; options: { id: string; name: string }[]; label: string }) {
  const router = useRouter();
  if (options.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{label}</span>
      <select
        className="input py-1"
        defaultValue={current}
        onChange={async (e) => {
          await post("/api/v1/me/active-tenant", locale, { tenantId: e.target.value });
          router.push("/dashboard");
          router.refresh();
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SignOutButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={async () => {
        await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        // Full reload on purpose: drops every client-cached page rendered for the signed-out user.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/login");
      }}
    >
      {label}
    </button>
  );
}

type SessionRow = { id: string; token: string; createdAt: string; updatedAt: string; userAgent?: string | null; ipAddress?: string | null };

/** AUTH-13: list and revoke one's own sessions (Better Auth endpoints). */
export function SessionsList({ locale, currentSessionId }: { locale: Locale; currentSessionId: string }) {
  const t = useMemo(() => translator(locale), [locale]);
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (rows !== null) return;
    fetch("/api/auth/list-sessions")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setRows)
      .catch(() => setError(true));
  }, [rows]);
  const fmt = new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium", timeStyle: "short" });
  if (error) return <p role="alert" className="text-sm text-red-700">{t("error.INTERNAL")}</p>;
  if (!rows) return <p className="text-sm text-muted">{t("common.loading")}</p>;
  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {rows.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <div>
            <div className="font-medium">{s.userAgent?.slice(0, 80) ?? t("account.unknownDevice")}</div>
            <div className="text-xs text-muted">
              {t("account.lastActive")}: {fmt.format(new Date(s.updatedAt))} · <bdi>{s.ipAddress ?? "—"}</bdi>
            </div>
          </div>
          {s.id === currentSessionId ? (
            <span className="badge">{t("account.thisDevice")}</span>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                await fetch("/api/auth/revoke-session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: s.token }) });
                setRows(null);
              }}
            >
              {t("account.revoke")}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
