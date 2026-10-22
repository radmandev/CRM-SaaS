import Link from "next/link";
import { LocaleSwitcher } from "@/components/actions";
import { Icon, type IconName } from "@/components/icons";
import { pageT, pageUser } from "@/server/page";

// Public landing page and a map of the app. Claims stay factual: no live supplier connections and no
// ZATCA Phase 2 integration are promised (they are not built). The preview is labelled as an illustration.

const AREAS: { key: string; href: string; icon: IconName }[] = [
  { key: "bookings", href: "/bookings", icon: "bookings" },
  { key: "quotations", href: "/quotations", icon: "quotations" },
  { key: "invoices", href: "/invoices", icon: "invoices" },
  { key: "payments", href: "/payments", icon: "payments" },
  { key: "customers", href: "/customers", icon: "customers" },
  { key: "suppliers", href: "/suppliers", icon: "suppliers" },
  { key: "reports", href: "/reports", icon: "reports" },
  { key: "settings", href: "/settings/agency", icon: "settings" },
];

const TRUST: { key: string; icon: IconName }[] = [
  { key: "security", icon: "shield" },
  { key: "zatca", icon: "qr" },
  { key: "manual", icon: "hand" },
];

export default async function Home() {
  const { locale, t } = await pageT();
  const user = await pageUser().catch(() => null);
  const primary = user ? { href: "/dashboard", label: t("landing.openApp") } : { href: "/signup", label: t("landing.start") };
  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-2 whitespace-nowrap text-base font-bold sm:text-lg">
            <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-brand text-white shadow-md shadow-brand/30"><Icon name="plane" className="size-5" /></span>
            {t("app.name")}
          </span>
          <nav aria-label={t("landing.navLabel")} className="flex items-center gap-2">
            <LocaleSwitcher locale={locale} loggedIn={!!user} />
            {!user && <Link href="/login" className="btn-ghost whitespace-nowrap">{t("landing.login")}</Link>}
            <Link href={primary.href} className="btn-primary hidden whitespace-nowrap sm:inline-flex">{primary.label}</Link>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="relative isolate">
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_85%_-10%,color-mix(in_srgb,var(--brand)_22%,transparent),transparent),radial-gradient(40rem_24rem_at_0%_20%,rgb(245_158_11/0.12),transparent)]" />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-2 lg:py-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/10 px-3 py-1 text-sm font-medium text-brand">
                <Icon name="plane" className="size-4" /> {t("landing.eyebrow")}
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{t("landing.title")}</h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{t("landing.subtitle")}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={primary.href} className="btn-primary px-5 py-3 text-base">
                  {primary.label} <Icon name="arrow" className="size-4" />
                </Link>
                <a href="#areas" className="btn-secondary px-5 py-3 text-base">{t("landing.explore")}</a>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
                {(["point1", "point2", "point3"] as const).map((k) => (
                  <li key={k} className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-brand/10 text-brand"><Icon name="check" className="size-3.5" /></span>{t(`landing.${k}`)}</li>
                ))}
              </ul>
            </div>

            {/* Illustration of the dashboard: static sample figures, labelled as such. */}
            <figure className="relative">
              <div aria-hidden="true" className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-brand/25 via-brand/5 to-amber-400/20 blur-2xl" />
              <div className="rounded-2xl border border-line bg-surface p-5 shadow-2xl shadow-brand/10">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-sm font-semibold">{t("landing.preview.title")}</span>
                  <span className="badge text-muted">{t("landing.preview.sample")}</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {(["sales", "receivables", "quotes"] as const).map((k, n) => (
                    <div key={k} className="rounded-xl border border-line bg-bg/60 p-3">
                      <p className="text-xs text-muted">{t(`landing.preview.${k}`)}</p>
                      <p className="mt-1 text-lg font-bold" dir="ltr">{["48,250", "12,900", "17"][n]}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex h-28 items-end gap-2 rounded-xl border border-line bg-bg/60 p-3" aria-hidden="true">
                  {[38, 52, 44, 66, 58, 80, 72, 92].map((h, i) => (
                    <span key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-brand/70 to-brand/30" style={{ height: `${h}%` }} />
                  ))}
                </div>
                <ul className="mt-4 space-y-2 text-sm">
                  {(["row1", "row2"] as const).map((k, n) => (
                    <li key={k} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                      <span className="flex items-center gap-2"><Icon name={n ? "invoices" : "bookings"} className="size-4 text-brand" />{t(`landing.preview.${k}`)}</span>
                      <span className={`badge ${n ? "border-emerald-300 text-emerald-800 dark:text-emerald-300" : "border-amber-300 text-amber-800 dark:text-amber-300"}`}>{t(`landing.preview.${k}Status`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <figcaption className="sr-only">{t("landing.preview.caption")}</figcaption>
            </figure>
          </div>
        </section>

        {/* Areas of the app */}
        <section id="areas" aria-labelledby="areas-h" className="scroll-mt-20 border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 id="areas-h" className="text-3xl font-bold tracking-tight">{t("landing.areasTitle")}</h2>
            <p className="mt-2 text-muted">{user ? t("landing.areasHintIn") : t("landing.areasHintOut")}</p>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {AREAS.map((a) => (
                <li key={a.key}>
                  <Link href={a.href} className="group card flex h-full flex-col transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/10">
                    <span aria-hidden="true" className="grid size-11 place-items-center rounded-xl bg-brand/10 text-brand transition group-hover:bg-brand group-hover:text-white">
                      <Icon name={a.icon} />
                    </span>
                    <h3 className="mt-4 font-semibold">{t(`landing.area.${a.key}.title`)}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{t(`landing.area.${a.key}.body`)}</p>
                    <span className="mt-4 flex items-center gap-1 text-sm font-medium text-brand">{t("landing.open")} <Icon name="arrow" className="size-4 transition group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-h" className="mx-auto max-w-6xl px-4 py-16">
          <h2 id="how-h" className="text-3xl font-bold tracking-tight">{t("landing.howTitle")}</h2>
          <ol className="mt-10 grid gap-6 sm:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <li key={n} className="relative">
                <span className="grid size-10 place-items-center rounded-full bg-brand text-lg font-bold text-white shadow-md shadow-brand/30">{n}</span>
                <h3 className="mt-4 font-semibold">{t(`landing.step${n}.title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{t(`landing.step${n}.body`)}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Facts worth knowing */}
        <section aria-labelledby="trust-h" className="mx-auto max-w-6xl px-4 pb-16">
          <h2 id="trust-h" className="sr-only">{t("landing.trustTitle")}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {TRUST.map((k) => (
              <div key={k.key} className="card">
                <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300"><Icon name={k.icon} /></span>
                <h3 className="mt-3 font-semibold">{t(`landing.trust.${k.key}.title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{t(`landing.trust.${k.key}.body`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto max-w-6xl px-4 pb-20">
          <div className="relative isolate overflow-hidden rounded-3xl bg-brand px-6 py-12 text-center text-white shadow-xl shadow-brand/20 sm:px-12">
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(30rem_16rem_at_20%_0%,rgb(255_255_255/0.18),transparent),radial-gradient(30rem_16rem_at_90%_100%,rgb(0_0_0/0.18),transparent)]" />
            <h2 className="text-2xl font-bold sm:text-3xl">{t("landing.ctaTitle")}</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/85">{t("landing.ctaBody")}</p>
            <Link href={primary.href} className="mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 font-semibold text-brand shadow-sm transition hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              {primary.label} <Icon name="arrow" className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted">
          <span>{t("app.name")}</span>
          <span>{t("landing.footer")}</span>
        </div>
      </footer>
    </div>
  );
}
