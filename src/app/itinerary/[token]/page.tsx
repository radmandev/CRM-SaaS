import { notFound } from "next/navigation";
import { pageT } from "@/server/page";
import { publicItinerary } from "@/modules/bookings/service";
import { formatDate } from "@/lib/format";
import { LocaleSwitcher } from "@/components/actions";

// BKG-13: public, read-only, signed and expiring. No login, no passport data, not indexed.
export const metadata = { title: "Itinerary", robots: { index: false, follow: false } };

export default async function PublicItinerary({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { locale, t } = await pageT();
  const it = await publicItinerary(token, locale);
  if (!it) notFound();
  const agency = (locale === "ar" && (it.agency.tradeNameAr || it.agency.legalNameAr)) || it.agency.tradeNameEn || it.agency.legalNameEn;
  const days = [...new Set(it.entries.map((e) => e.date))];
  return (
    <main style={{ "--brand": it.agency.primaryColor } as React.CSSProperties} className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-sm text-muted">{agency}</p>
          <h1 className="text-2xl font-bold">{t("public.itineraryFor", { name: it.customer })}</h1>
          <p className="text-sm text-muted"><bdi dir="ltr">{it.reference}</bdi>{it.travelStartDate && ` · ${formatDate(it.travelStartDate, locale)} – ${formatDate(it.travelEndDate!, locale)}`}</p>
        </div>
        <LocaleSwitcher locale={locale} loggedIn={false} />
      </header>
      <section className="mb-6" aria-labelledby="travellers">
        <h2 id="travellers" className="mb-2 font-semibold">{t("booking.passengers")}</h2>
        <ul className="text-sm" dir="ltr">
          {it.passengers.map((p, n) => <li key={n}>{[p.title, p.firstName, p.lastName].filter(Boolean).join(" ")} ({p.paxType})</li>)}
        </ul>
      </section>
      <ol className="space-y-5">
        {days.map((d) => (
          <li key={d}>
            <h3 className="mb-2 font-semibold text-brand">{formatDate(d, locale)}</h3>
            <ul className="space-y-2">
              {it.entries.filter((e) => e.date === d).map((e, n) => (
                <li key={n} className="card p-3 sm:p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    {e.time && <bdi dir="ltr" className="font-mono text-sm">{e.time}</bdi>}
                    <span className="badge">{t(`itinerary.${e.kind}`)}</span>
                    <span className="font-medium">{e.title}</span>
                  </div>
                  {e.detail && <p className="mt-1 text-sm text-muted"><bdi dir="ltr">{e.detail}</bdi></p>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {it.customerNotes && <p className="mt-6 whitespace-pre-line rounded-md border border-line p-3 text-sm">{it.customerNotes}</p>}
      <footer className="mt-8 border-t border-line pt-4 text-xs text-muted">
        {t("public.contact")}: <bdi dir="ltr">{[it.agency.phone, it.agency.email].filter(Boolean).join(" · ")}</bdi>
        <p className="mt-1">{t("public.subjectToConfirmation")}</p>
      </footer>
    </main>
  );
}
