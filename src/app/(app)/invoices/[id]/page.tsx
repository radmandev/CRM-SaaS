import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { ApiForm, Field } from "@/components/api-form";
import { ActionButton } from "@/components/actions";
import { DocumentLinks } from "@/components/documents";
import { Money, PageHeader, StatusBadge, TableScroll } from "@/components/ui";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { pageCtx, pageT } from "@/server/page";
import { getInvoice } from "@/modules/finance/invoices";
import { latestDocuments } from "@/modules/documents/service";
import { formatDate, formatDateTime } from "@/lib/format";
import { invoiceTone, MANUAL_METHODS } from "@/components/finance";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  const inv = await getInvoice(ctx, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const draft = inv.status === "DRAFT";
  const p = inv.permissions;
  const [taxRates, accounts, docs, qr] = await Promise.all([
    draft && p.issue ? ctx.db.taxRate.findMany({ where: { active: true }, orderBy: { code: "asc" } }) : Promise.resolve([]),
    p.recordPayment ? ctx.db.financialAccount.findMany({ where: { active: true, currency: inv.currency }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    latestDocuments(ctx, "Invoice", [inv.id]),
    inv.qrPayload ? QRCode.toDataURL(inv.qrPayload, { margin: 1, width: 160 }) : Promise.resolve(null),
  ]);
  const money = (v: { toString(): string } | null | undefined) => <Money value={v == null ? null : v.toString()} currency={inv.currency} locale={locale} />;
  const title = draft ? t("inv.draftTitle") : `${t(inv.kind === "CREDIT_NOTE" ? "invKind.CREDIT_NOTE" : `invType.${inv.type}`)} ${inv.number}`;
  return (
    <>
      <PageHeader
        title={title}
        description={`${inv.customer.displayName}${inv.booking ? ` · ${inv.booking.reference}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={invoiceTone(inv)} label={draft ? t("invStatus.DRAFT") : inv.kind === "CREDIT_NOTE" ? t("invKind.CREDIT_NOTE") : Number(inv.outstanding) <= 0 ? t("inv.paid") : t("inv.unpaid")} />
            {p.issue && <ActionButton url={`/api/v1/invoices/${inv.id}/issue`} label={t("inv.issue")} locale={locale} confirm={t("inv.issueConfirm")} />}
            {draft && p.issue && <ActionButton url={`/api/v1/invoices/${inv.id}`} method="DELETE" label={t("inv.deleteDraft")} locale={locale} variant="danger" confirm={t("common.deleteConfirm")} />}
            {!draft && can(ctx, "invoice:issue") && <ActionButton url={`/api/v1/invoices/${inv.id}/send`} label={t("inv.sendEmail")} locale={locale} confirm={t("inv.sendConfirm")} />}
          </div>
        }
      />
      {inv.booking && <p className="mb-2 text-sm">{t("booking.title")}: <Link className="underline" href={`/bookings/${inv.booking.id}`} dir="ltr">{inv.booking.reference}</Link></p>}
      {inv.original && <p className="mb-2 text-sm">{t("inv.creditsInvoice")} <Link className="underline" href={`/invoices/${inv.original.id}`} dir="ltr">{inv.original.number}</Link> · {inv.reason}</p>}
      {!draft && <p className="mb-4 text-xs text-muted">{t("inv.immutableNote")}</p>}

      <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 xl:col-span-2">
          <section className="card" aria-labelledby="lines">
            <h2 id="lines" className="mb-3 font-semibold">{t("inv.lines")}</h2>
            <TableScroll label={t("inv.lines")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("inv.lineDescription")}</th><th scope="col">{t("item.quantity")}</th><th scope="col">{t("inv.unitPrice")}</th>
                  <th scope="col">{t("item.discount")}</th><th scope="col">{t("inv.taxable")}</th><th scope="col">{t("booking.tax")}</th><th scope="col">{t("booking.total")}</th>
                  {draft && p.issue && <th scope="col"><span className="sr-only">{t("common.delete")}</span></th>}
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l) => {
                  const snap = l.taxRateSnapshot as { rate: string; zatcaCode: string };
                  return (
                    <tr key={l.id}>
                      <td>{l.descriptionEn}{l.descriptionAr && <div className="text-xs text-muted">{l.descriptionAr}</div>}</td>
                      <td dir="ltr">{Number(l.quantity)}</td><td>{money(l.unitPrice)}</td><td>{money(l.discount)}</td><td>{money(l.netAmount)}</td>
                      <td>{money(l.taxAmount)} <span className="text-xs text-muted" dir="ltr">{Number(snap.rate)}% {snap.zatcaCode}</span></td><td>{money(l.totalAmount)}</td>
                      {draft && p.issue && <td><ActionButton url={`/api/v1/invoices/${inv.id}/lines/${l.id}`} method="DELETE" label={t("common.remove")} locale={locale} variant="danger" /></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </TableScroll>
            <dl className="ms-auto mt-3 max-w-sm space-y-1 text-sm">
              <div className="flex justify-between"><dt>{t("inv.totalExclVat")}</dt><dd>{money(inv.taxableAmount)}</dd></div>
              <div className="flex justify-between"><dt>{t("booking.tax")}</dt><dd>{money(inv.taxAmount)}</dd></div>
              <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>{t("inv.totalInclVat")}</dt><dd>{money(inv.total)}</dd></div>
              {inv.kind === "INVOICE" && !draft && (
                <>
                  <div className="flex justify-between"><dt>{t("inv.credited")}</dt><dd>{money(inv.amountCredited)}</dd></div>
                  <div className="flex justify-between"><dt>{t("booking.paid")}</dt><dd>{money(inv.amountPaid)}</dd></div>
                  <div className="flex justify-between font-semibold"><dt>{t("inv.outstanding")}</dt><dd>{money(inv.outstanding)}</dd></div>
                </>
              )}
            </dl>
            {draft && p.issue && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm underline">{t("inv.addLine")}</summary>
                <ApiForm action={`/api/v1/invoices/${inv.id}/lines`} schema="invoiceLine" locale={locale} submitLabel={t("common.add")} resetOnSuccess className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-3"><Field name="descriptionEn" label={t("inv.lineDescription")} required /></div>
                  <Field name="descriptionAr" label={t("inv.lineDescriptionAr")} dir="rtl" />
                  <Field name="quantity" label={t("item.quantity")} defaultValue="1" dir="ltr" />
                  <Field name="unitPrice" label={t("inv.unitPrice")} dir="ltr" required />
                  <Field name="discount" label={t("item.discount")} defaultValue="0" dir="ltr" />
                  <Field name="taxRateId" label={t("item.taxRate")} options={[{ value: "", label: "—" }, ...taxRates.map((r) => ({ value: r.id, label: locale === "ar" ? r.nameAr : r.nameEn }))]} defaultValue={taxRates.find((r) => r.category === "STANDARD")?.id} />
                </ApiForm>
              </details>
            )}
          </section>

          {p.credit && (
            <section className="card" aria-labelledby="credit">
              <h2 id="credit" className="mb-1 font-semibold">{t("inv.issueCredit")}</h2>
              <p className="mb-3 text-xs text-muted">{t("inv.creditHint")}</p>
              <ApiForm action={`/api/v1/invoices/${inv.id}/credit-notes`} schema="creditNote" locale={locale} submitLabel={t("inv.issueCredit")} className="space-y-3">
                <Field name="reason" label={t("inv.creditReason")} required />
                {inv.lines.filter((l) => Number(l.creditable) > 0).map((l, n) => (
                  <div key={l.id} className="grid items-end gap-2 sm:grid-cols-3">
                    <input type="hidden" name={`lines.${n}.originalLineId`} value={l.id} />
                    <p className="text-sm sm:col-span-2">{l.descriptionEn} <span className="text-muted">({t("inv.creditable")} {money(l.creditable)})</span></p>
                    <Field name={`lines.${n}.amount`} label={t("inv.creditAmount")} dir="ltr" placeholder={l.creditable.toString()} />
                  </div>
                ))}
              </ApiForm>
            </section>
          )}

          {p.recordPayment && Number(inv.outstanding) > 0 && (
            <section className="card" aria-labelledby="pay">
              <h2 id="pay" className="mb-3 font-semibold">{t("pay.record")}</h2>
              <ApiForm action="/api/v1/payments" schema="payment" locale={locale} submitLabel={t("pay.record")} extra={{ customerId: inv.customerId, currency: inv.currency, ...(inv.booking ? { bookingId: inv.booking.id } : {}) }} className="grid gap-3 sm:grid-cols-3">
                <Field name="amount" label={t("pay.amount")} defaultValue={inv.outstanding?.toFixed(2)} dir="ltr" required />
                <Field name="date" type="date" label={t("item.date")} defaultValue={new Date().toISOString().slice(0, 10)} required />
                <Field name="method" label={t("pay.method")} options={MANUAL_METHODS.map((m) => ({ value: m, label: t(`method.${m}`) }))} />
                <Field name="financialAccountId" label={t("pay.account")} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
                <Field name="reference" label={t("pay.reference")} dir="ltr" hint={t("pay.referenceHint")} />
                <input type="hidden" name="allocations.0.invoiceId" value={inv.id} />
                <Field name="allocations.0.amount" label={t("pay.applyToInvoice")} defaultValue={inv.outstanding?.toFixed(2)} dir="ltr" />
              </ApiForm>
            </section>
          )}
        </div>

        <div className="space-y-6">
          {!draft && (
            <section className="card space-y-2 text-sm" aria-labelledby="meta">
              <h2 id="meta" className="mb-1 font-semibold">{t("inv.details")}</h2>
              <p>{t("inv.issuedAt")}: {inv.issuedAt && formatDateTime(inv.issuedAt, locale, ctx.tenant.timezone)}</p>
              {inv.supplyDate && <p>{t("inv.supplyDate")}: {formatDate(inv.supplyDate, locale)}</p>}
              {inv.dueDate && inv.kind === "INVOICE" && <p>{t("inv.due")}: {formatDate(inv.dueDate, locale)}</p>}
              <p className="text-xs text-muted" dir="ltr">ICV {inv.icv} · UUID {inv.zatcaUuid}</p>
              <p className="text-xs text-muted">{t("inv.zatcaStatus")}: {t(`zatca.${inv.zatcaStatus}`)}</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimize */}
              {qr && <img src={qr} alt={t("inv.qrAlt")} width={160} height={160} />}
            </section>
          )}
          {draft && p.issue && (
            <section className="card" aria-labelledby="dset">
              <h2 id="dset" className="mb-3 font-semibold">{t("inv.draftSettings")}</h2>
              <ApiForm action={`/api/v1/invoices/${inv.id}`} method="PATCH" schema="invoiceUpdate" locale={locale} submitLabel={t("common.save")} extra={{ version: inv.version }} className="space-y-3">
                <Field name="type" label={t("inv.type")} options={["SIMPLIFIED", "STANDARD"].map((x) => ({ value: x, label: t(`invType.${x}`) }))} defaultValue={inv.type} hint={t("inv.typeHint")} />
                <Field name="supplyDate" type="date" label={t("inv.supplyDate")} defaultValue={inv.supplyDate} />
                <Field name="notes" label={t("crm.notes")} defaultValue={inv.notes} multiline />
              </ApiForm>
            </section>
          )}
          {!draft && (
            <section className="card" aria-labelledby="idocs">
              <h2 id="idocs" className="mb-3 font-semibold">{t("docs.title")}</h2>
              {docs.length === 0 && <p className="mb-2 text-sm text-amber-800 dark:text-amber-300">{t("docs.generating")}</p>}
              <DocumentLinks docs={docs} requestUrl={docs.length === 0 ? `/api/v1/invoices/${inv.id}/pdf` : undefined} locale={locale} t={t} />
            </section>
          )}
          {inv.allocations.length > 0 && (
            <section className="card" aria-labelledby="allocs">
              <h2 id="allocs" className="mb-3 font-semibold">{t("inv.payments")}</h2>
              <ul className="space-y-1 text-sm">{inv.allocations.map((a) => <li key={a.id}><span dir="ltr">{a.payment.number}</span> · {formatDate(a.payment.date, locale)} · {money(a.amount)}</li>)}</ul>
            </section>
          )}
          {inv.creditNotes.length > 0 && (
            <section className="card" aria-labelledby="cns">
              <h2 id="cns" className="mb-3 font-semibold">{t("inv.creditNotes")}</h2>
              <ul className="space-y-1 text-sm">{inv.creditNotes.map((c) => <li key={c.id}><Link className="underline" href={`/invoices/${c.id}`} dir="ltr">{c.number}</Link> · {money(c.total)} · {c.reason}</li>)}</ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
