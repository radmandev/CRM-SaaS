import Link from "next/link";
import { LocaleSwitcher } from "@/components/actions";
import { Icon } from "@/components/icons";
import { pageT, pageUser } from "@/server/page";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { locale, t } = await pageT();
  const user = await pageUser();
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel (decorative summary of the product; hidden on small screens). */}
      <aside className="relative isolate hidden overflow-hidden bg-brand p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(36rem_20rem_at_10%_0%,rgb(255_255_255/0.18),transparent),radial-gradient(30rem_20rem_at_100%_100%,rgb(0_0_0/0.22),transparent)]" />
        <Link href="/" className="flex w-fit items-center gap-2 text-lg font-bold">
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-white/15"><Icon name="plane" className="size-5" /></span>
          {t("app.name")}
        </Link>
        <div>
          <p className="text-3xl font-bold leading-snug">{t("landing.title")}</p>
          <ul className="mt-8 space-y-3 text-white/90">
            {(["point1", "point2", "point3"] as const).map((k) => (
              <li key={k} className="flex items-center gap-3">
                <span className="grid size-6 place-items-center rounded-full bg-white/15"><Icon name="check" className="size-3.5" /></span>
                {t(`landing.${k}`)}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-white/85">{t("landing.eyebrow")}</p>
      </aside>

      <main className="flex flex-col px-4 py-8 sm:px-8">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold lg:invisible">
            <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-brand text-white"><Icon name="plane" className="size-4" /></span>
            {t("app.name")}
          </Link>
          <LocaleSwitcher locale={locale} loggedIn={!!user} />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <div className="card p-6 sm:p-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
