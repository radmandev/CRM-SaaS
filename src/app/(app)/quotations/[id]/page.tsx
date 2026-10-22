import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiForm, Checkbox, Field } from "@/components/api-form";
import { ActionButton } from "@/components/actions";
import { DocumentLinks } from "@/components/documents";
import { ItemFields, ItineraryLinkButton } from "@/components/travel";
import { EmptyState, Money, PageHeader, StatusBadge } from "@/components/ui";
import { AppError } from "@/server/errors";
import { pageCtx, pageT } from "@/server/page";
import { getQuotation } from "@/modules/sales/service";
import { latestDocuments } from "@/modules/documents/service";
import { formatDate } from "@/lib/format";
import { LOST_REASONS } from "@/lib/schemas-finance";

export const metadata = { title: "Quotation" };

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  const q = await getQuotation(ctx, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const p = q.permissions;
  const [suppliers, taxRates, docs] = await Promise.all([
    p.edit ? ctx.db.supplier.findMany({ where: { archivedAt: null }, orderBy: { nameEn: "asc" }, take: 300 }) : Promise.resolve([]),
    p.edit ? ctx.db.taxRate.findMany({ where: { active: true }, orderBy: { code: "asc" } }) : Promise.resolve([]),
    latestDocuments(ctx, "Quotation", [q.id]),
  ]);
  const money = (v: { toString(): string } | null) => <Money value={v == null ? null : v.toString()} currency={q.currency} locale={locale} />;
  const vat = taxRates.find((r) => r.category === "STANDARD");
  return (
    <>
      <PageHeader
        title={`${q.number ?? t("quote.draftNumber")} v${q.versionNo}`}
        description={`${q.customer.displayName} · ${t("quote.validUntil")} ${formatDate(q.validUntil!, locale)} · ${q.owner.user.name}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={q.status === "SENT" ? "ON_HOLD" : q.status === "ACCEPTED" || q.status === "CONVERTED" ? "CONFIRMED" : q.status === "DRAFT" ? "DRAFT" : "CANCELLED"} label={t(`quoteStatus.${q.status}`)} />
            {p.approve && <ActionButton url={`/api/v1/quotations/${q.id}/approve`} label={t("quote.approve")} locale={locale} confirm={t("quote.approveConfirm")} />}
            {p.send && <ActionButton url={`/api/v1/quotations/${q.id}/send`} body={{ manual: false }} label={t("quote.sendEmail")} locale={locale} confirm={t("quote.sendConfirm", { email: q.customer.email ?? "—" })} />}
            {p.send && <ActionButton url={`/api/v1/quotations/${q.id}/send`} body={{ manual: true }} label={t("quote.markSent")} locale={locale} />}
            {p.decide && <ActionButton url={`/api/v1/quotations/${q.id}/accept`} body={{ version: q.version }} label={t("quote.accept")} locale={locale} confirm={t("quote.acceptConfirm")} />}
            {p.revise && <ActionButton url={`/api/v1/quotations/${q.id}/revise`} label={t("quote.revise")} locale={locale} />}
            {p.convert && <ActionButton url={`/api/v1/quotations/${q.id}/convert`} label={t("quote.convert")} locale={locale} confirm={t("quote.convertConfirm")} />}
            {q.status !== "DRAFT" && <ItineraryLinkButton url={`/api/v1/quotations/${q.id}/link`} locale={locale} />}
          </div>
        }
      />
      {q.requiresApproval && !q.approvedAt && q.status === "DRAFT" && <p role="note" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{t("quote.approvalNote")}</p>}
      {q.booking && <p className="mb-4 text-sm">{t("quote.convertedTo")} <Link className="underline" href={`/bookings/${q.booking.id}`} dir="ltr">{q.booking.reference}</Link></p>}
      {q.lostReason && <p className="mb-4 text-sm">{t("quote.lost")}: {t(`lost.${q.lostReason}`)}{q.lostNote ? ` · ${q.lostNote}` : ""}</p>}
      <p className="mb-4 text-xs text-muted">{t("quote.notReservation")}</p>

      <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 xl:col-span-2">
          <section className="card" aria-labelledby="items">
            <h2 id="items" className="mb-4 font-semibold">{t("booking.services")}</h2>
            {q.items.length === 0 && <EmptyState title={t("booking.noServices")} />}
            <ul className="space-y-3">
              {q.items.map((i) => (
                <li key={i.id} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className="badge me-2">{t(`service.${i.serviceType}`)}</span><span className="font-semibold">{i.description}</span>
                      <div className="text-sm text-muted">{formatDate(i.startDate!, locale)}{i.endDate !== i.startDate ? ` – ${formatDate(i.endDate!, locale)}` : ""}{i.supplier ? ` · ${(locale === "ar" && i.supplier.nameAr) || i.supplier.nameEn}` : ""}</div>
                    </div>
                    <div className="text-end text-sm">
                      {money(i.sellAmount.plus(i.serviceFeeAmount).minus(i.discountAmount))}
                      {Number(i.discountAmount) > 0 && <div className="text-xs text-muted">{t("item.discount")} {money(i.discountAmount)}</div>}
                      {p.margin && <div className="text-xs text-muted">{t("item.cost")} {money(i.costAmount)}</div>}
                    </div>
                  </div>
                  {p.edit && (
                    <div className="mt-2 flex flex-wrap gap-4 border-t border-line pt-2">
                      <details>
                        <summary className="cursor-pointer text-sm underline">{t("common.edit")}</summary>
                        <ApiForm action={`/api/v1/quotations/${q.id}/items/${i.id}`} method="PATCH" schema="itemChanges" locale={locale} submitLabel={t("common.save")} className="mt-2 grid gap-3 sm:grid-cols-3">
                          <div className="sm:col-span-3"><Field name="description" label={t("item.description")} defaultValue={i.description} /></div>
                          <Field name="sellAmount" label={t("item.sell")} defaultValue={i.sellAmount.toString()} dir="ltr" />
                          <Field name="discountAmount" label={t("item.discount")} defaultValue={i.discountAmount.toString()} dir="ltr" />
                          {p.margin && <Field name="costAmount" label={t("item.cost")} defaultValue={i.costAmount?.toString()} dir="ltr" />}
                        </ApiForm>
                      </details>
                      <ActionButton url={`/api/v1/quotations/${q.id}/items/${i.id}`} method="DELETE" label={t("common.delete")} locale={locale} variant="danger" confirm={t("common.deleteConfirm")} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {p.edit && (
              <details className="mt-4" open={q.items.length === 0}>
                <summary className="cursor-pointer font-medium underline">{t("booking.addService")}</summary>
                <ApiForm action={`/api/v1/quotations/${q.id}/items`} schema="bookingItem" locale={locale} submitLabel={t("booking.addService")} className="mt-3 space-y-4">
                  <ItemFields locale={locale} suppliers={suppliers.map((s) => ({ value: s.id, label: (locale === "ar" && s.nameAr) || s.nameEn }))} taxRates={taxRates.map((r) => ({ value: r.id, label: locale === "ar" ? r.nameAr : r.nameEn }))} defaultTaxRateId={vat?.id} />
                </ApiForm>
              </details>
            )}
          </section>

          {p.edit && (
            <section className="card" aria-labelledby="qsettings">
              <h2 id="qsettings" className="mb-4 font-semibold">{t("quote.settings")}</h2>
              <ApiForm action={`/api/v1/quotations/${q.id}`} method="PATCH" schema="quotationUpdate" locale={locale} submitLabel={t("common.save")} extra={{ version: q.version }} className="grid gap-4 sm:grid-cols-2">
                <Field name="validUntil" type="date" label={t("quote.validUntil")} defaultValue={q.validUntil} required />
                <Checkbox name="showItemPrices" label={t("quote.showItemPrices")} defaultChecked={q.showItemPrices} />
                <Field name="customerNotes" label={t("booking.customerNotes")} defaultValue={q.customerNotes} multiline />
                <Field name="notes" label={t("booking.internalNotes")} defaultValue={q.notes} multiline />
                <Field name="termsEn" label={t("quote.termsEn")} defaultValue={q.termsEn} multiline dir="ltr" hint={t("quote.termsHint")} />
                <Field name="termsAr" label={t("quote.termsAr")} defaultValue={q.termsAr} multiline dir="rtl" />
              </ApiForm>
            </section>
          )}
        </div>

        <div className="space-y-6">
          <section className="card" aria-labelledby="qtotals">
            <h2 id="qtotals" className="mb-3 font-semibold">{t("booking.totals")}</h2>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt>{t("booking.subtotal")}</dt><dd>{money(q.sellTotal)}</dd></div>
              {Number(q.discountTotal) > 0 && <div className="flex justify-between"><dt>{t("item.discount")}</dt><dd>{money(q.discountTotal)}</dd></div>}
              <div className="flex justify-between"><dt>{t("booking.tax")}</dt><dd>{money(q.taxTotal)}</dd></div>
              <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>{t("booking.total")}</dt><dd>{money(q.grandTotal)}</dd></div>
              {p.margin && <div className="flex justify-between text-muted"><dt>{t("booking.costTotal")}</dt><dd>{money(q.costTotal)}</dd></div>}
            </dl>
          </section>
          <section className="card" aria-labelledby="qdocs">
            <h2 id="qdocs" className="mb-3 font-semibold">{t("docs.title")}</h2>
            <DocumentLinks docs={docs} requestUrl={`/api/v1/quotations/${q.id}/pdf`} locale={locale} t={t} label={t("quote.pdf")} />
          </section>
          {p.decide && (
            <section className="card" aria-labelledby="qlost">
              <h2 id="qlost" className="mb-3 font-semibold">{t("quote.reject")}</h2>
              <ApiForm action={`/api/v1/quotations/${q.id}/reject`} locale={locale} submitLabel={t("quote.reject")} extra={{ version: q.version }} className="space-y-3">
                <Field name="lostReason" label={t("quote.lostReason")} options={LOST_REASONS.map((r) => ({ value: r, label: t(`lost.${r}`) }))} />
                <Field name="lostNote" label={t("item.note")} />
              </ApiForm>
            </section>
          )}
          <section className="card" aria-labelledby="qversions">
            <h2 id="qversions" className="mb-3 font-semibold">{t("quote.versions")}</h2>
            <ul className="space-y-1 text-sm">
              {q.versions.map((v) => (
                <li key={v.id}>{v.id === q.id ? <b>v{v.versionNo}</b> : <Link className="underline" href={`/quotations/${v.id}`}>v{v.versionNo}</Link>} · {t(`quoteStatus.${v.status}`)}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
