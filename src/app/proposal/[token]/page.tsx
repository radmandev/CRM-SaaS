import { notFound } from "next/navigation";
import { pageT } from "@/server/page";
import { publicProposal } from "@/modules/sales/service";
import { formatDate } from "@/lib/format";
import { LocaleSwitcher } from "@/components/actions";
import { Money } from "@/components/ui";

// QT-05: the customer's view of a sent quotation. Signed, expiring, read-only; no costs or internal notes.
export const metadata = { title: "Proposal", robots: { index: false, follow: false } };

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { locale, t } = await pageT();
  const q = await publicProposal(token);
  if (!q) notFound();
  const agency = (locale === "ar" && (q.agency.tradeNameAr || q.agency.legalNameAr)) || q.agency.tradeNameEn || q.agency.legalNameEn;
  const terms = locale === "ar" ? q.termsAr || q.termsEn : q.termsEn || q.termsAr;
  return (
    <main style={{ "--brand": q.agency.primaryColor } as React.CSSProperties} className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-sm text-muted">{agency}</p>
          <h1 className="text-2xl font-bold">{t("public.proposalFor", { name: q.customer })}</h1>
          <p className="text-sm text-muted"><bdi dir="ltr">{q.number} v{q.versionNo}</bdi> · {t("quote.validUntil")} {formatDate(q.validUntil, locale)}</p>
        </div>
        <LocaleSwitcher locale={locale} loggedIn={false} />
      </header>
      {q.status !== "SENT" && <p role="note" className="mb-4 rounded-md border border-line p-3 text-sm">{t(`public.proposalStatus.${q.status}`)}</p>}
      <ul className="space-y-2">
        {q.items.map((i, n) => (
          <li key={n} className="card flex flex-wrap items-start justify-between gap-2 p-3 sm:p-3">
            <div>
              <span className="badge me-2">{t(`service.${i.serviceType}`)}</span><span className="font-medium">{i.description}</span>
              <div className="text-sm text-muted">{formatDate(i.startDate, locale)}{i.endDate !== i.startDate ? ` – ${formatDate(i.endDate, locale)}` : ""}</div>
            </div>
            {i.price && <Money value={i.price} currency={q.currency} locale={locale} />}
          </li>
        ))}
      </ul>
      <dl className="ms-auto mt-4 max-w-xs space-y-1 text-sm">
        <div className="flex justify-between"><dt>{t("booking.subtotal")}</dt><dd><Money value={q.totals.sell} currency={q.currency} locale={locale} /></dd></div>
        <div className="flex justify-between"><dt>{t("booking.tax")}</dt><dd><Money value={q.totals.tax} currency={q.currency} locale={locale} /></dd></div>
        <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>{t("booking.total")}</dt><dd><Money value={q.totals.grand} currency={q.currency} locale={locale} /></dd></div>
      </dl>
      {q.customerNotes && <p className="mt-6 whitespace-pre-line text-sm">{q.customerNotes}</p>}
      <section className="mt-6 text-sm">
        <h2 className="mb-1 font-semibold">{t("pdf.terms")}</h2>
        <p className="whitespace-pre-line text-muted">{terms || t("pdf.defaultTerms")}</p>
        <p className="mt-2 text-muted">{t("pdf.subjectToAvailability")}</p>
      </section>
      <footer className="mt-8 border-t border-line pt-4 text-xs text-muted">{t("public.contact")}: <bdi dir="ltr">{[q.agency.phone, q.agency.email].filter(Boolean).join(" · ")}</bdi></footer>
    </main>
  );
}
