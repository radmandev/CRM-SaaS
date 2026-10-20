import Link from "next/link";
import { EmptyState, PageHeader, SearchBox, StatusBadge } from "@/components/ui";
import { pageCtx, pageT } from "@/server/page";
import { globalSearch } from "@/modules/search/service";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const r = await globalSearch(ctx, q);
  const nothing = !r.customers.length && !r.bookings.length && !r.suppliers.length;
  return (
    <>
      <PageHeader title={t("search.title")} description={t("search.subtitle")} />
      <SearchBox action="/search" defaultValue={q} label={t("common.search")} />
      {q.length >= 2 && nothing && <EmptyState title={t("common.noResults")} />}
      <div className="grid gap-6 md:grid-cols-3">
        {r.bookings.length > 0 && (
          <section className="card" aria-labelledby="sb">
            <h2 id="sb" className="mb-2 font-semibold">{t("nav.bookings")}</h2>
            <ul className="space-y-2 text-sm">
              {r.bookings.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2">
                  <span><Link className="underline" href={`/bookings/${b.id}`} dir="ltr">{b.reference}</Link> · {b.customer.displayName}</span>
                  <StatusBadge status={b.status} label={t(`bookingStatus.${b.status}`)} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {r.customers.length > 0 && (
          <section className="card" aria-labelledby="sc">
            <h2 id="sc" className="mb-2 font-semibold">{t("nav.customers")}</h2>
            <ul className="space-y-2 text-sm">
              {r.customers.map((c) => <li key={c.id}><Link className="underline" href={`/customers/${c.id}`}>{c.displayName}</Link> <span className="text-muted" dir="ltr">{c.code}</span></li>)}
            </ul>
          </section>
        )}
        {r.suppliers.length > 0 && (
          <section className="card" aria-labelledby="ss">
            <h2 id="ss" className="mb-2 font-semibold">{t("nav.suppliers")}</h2>
            <ul className="space-y-2 text-sm">
              {r.suppliers.map((s) => <li key={s.id}><Link className="underline" href={`/suppliers/${s.id}`}>{(locale === "ar" && s.nameAr) || s.nameEn}</Link> <span className="text-muted" dir="ltr">{s.code}</span></li>)}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
