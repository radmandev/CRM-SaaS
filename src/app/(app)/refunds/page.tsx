import Link from "next/link";
import { ApiForm, Field } from "@/components/api-form";
import { ActionButton } from "@/components/actions";
import { EmptyState, Money, NoPermission, PageHeader, Pager, StatusBadge } from "@/components/ui";
import { MANUAL_METHODS } from "@/components/finance";
import { can } from "@/server/context";
import { scopeWhere } from "@/server/scope";
import { pageCtx, pageT } from "@/server/page";
import { listRefunds } from "@/modules/finance/payments";
import { listQuery } from "@/lib/schemas";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Refunds" };
const TONE: Record<string, string> = { REQUESTED: "ON_HOLD", APPROVED: "CONFIRMED", PAID: "ISSUED", REJECTED: "CANCELLED", CANCELLED: "CANCELLED" };

export default async function RefundsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "refund:request")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const status = ["REQUESTED", "APPROVED", "PAID", "REJECTED", "CANCELLED"].includes(sp.status ?? "") ? sp.status : undefined;
  const { data, page } = await listRefunds(ctx, { ...listQuery.parse({ cursor: sp.cursor || undefined }), status });
  const approver = can(ctx, "refund:approve");
  const [customers, accounts] = await Promise.all([
    ctx.db.customer.findMany({ where: { archivedAt: null, mergedIntoId: null, ...scopeWhere(ctx, "customer:read") }, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, code: true, displayName: true } }),
    approver ? ctx.db.financialAccount.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title={t("ref.title")} description={t("ref.subtitle")} />
      <form action="/refunds" className="mb-4 flex gap-2">
        <select name="status" defaultValue={status ?? ""} className="input" aria-label={t("field.status")}>
          <option value="">{t("common.all")}</option>
          {Object.keys(TONE).map((s) => <option key={s} value={s}>{t(`refStatus.${s}`)}</option>)}
        </select>
        <button className="btn-secondary">{t("common.filter")}</button>
      </form>
      {data.length === 0 ? (
        <EmptyState title={t("common.noResults")} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {data.map((r) => (
            <li key={r.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-semibold" dir="ltr">{r.number}</span> · <Link className="hover:underline" href={`/customers/${r.customer.id}`}>{r.customer.displayName}</Link>
                  {r.booking && <> · <Link className="underline" href={`/bookings/${r.booking.id}`} dir="ltr">{r.booking.reference}</Link></>}
                  <div className="text-sm text-muted">{t(`method.${r.method}`)} · {r.reason}{r.paidAt ? ` · ${t("ref.paidOn")} ${formatDate(r.paidAt, locale)}` : ""}</div>
                  {r.decisionNote && <div className="text-xs text-muted">{r.decisionNote}</div>}
                </div>
                <div className="flex items-center gap-3">
                  <Money value={r.amount.toString()} currency={r.currency} locale={locale} />
                  <StatusBadge status={TONE[r.status]} label={t(`refStatus.${r.status}`)} />
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-3">
                {r.status === "REQUESTED" && approver && <ActionButton url={`/api/v1/refunds/${r.id}/approve`} label={t("ref.approve")} locale={locale} body={{}} confirm={t("ref.approveConfirm")} />}
                {r.status === "REQUESTED" && approver && <ActionButton url={`/api/v1/refunds/${r.id}/reject`} label={t("ref.reject")} locale={locale} body={{}} variant="danger" />}
                {r.status === "REQUESTED" && r.requestedById === ctx.user.id && <ActionButton url={`/api/v1/refunds/${r.id}/cancel`} label={t("common.cancel")} locale={locale} variant="danger" />}
                {r.status === "APPROVED" && approver && (
                  <details className="text-sm">
                    <summary className="cursor-pointer underline">{t("ref.markPaid")}</summary>
                    <ApiForm action={`/api/v1/refunds/${r.id}/paid`} schema="refundPaid" locale={locale} submitLabel={t("ref.markPaid")} className="mt-2 grid gap-2 sm:grid-cols-3">
                      <Field name="paidAt" type="date" label={t("item.date")} defaultValue={new Date().toISOString().slice(0, 10)} required />
                      <Field name="financialAccountId" label={t("pay.account")} options={accounts.filter((a) => a.currency === r.currency).map((a) => ({ value: a.id, label: a.name }))} />
                      <Field name="reference" label={t("pay.reference")} dir="ltr" />
                    </ApiForm>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager basePath="/refunds" nextCursor={page.nextCursor} hasCursor={!!sp.cursor} params={{ status }} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />
      {customers.length > 0 && (
        <section className="card mt-6" aria-labelledby="new-ref">
          <h2 id="new-ref" className="mb-1 font-semibold">{t("ref.request")}</h2>
          <p className="mb-4 text-xs text-muted">{t("ref.requestHint")}</p>
          <ApiForm action="/api/v1/refunds" schema="refundRequest" locale={locale} submitLabel={t("ref.request")} resetOnSuccess className="grid gap-4 sm:grid-cols-3">
            <Field name="customerId" label={t("booking.customer")} options={customers.map((c) => ({ value: c.id, label: `${c.displayName} (${c.code})` }))} />
            <Field name="amount" label={t("pay.amount")} dir="ltr" required />
            <Field name="method" label={t("pay.method")} options={MANUAL_METHODS.map((m) => ({ value: m, label: t(`method.${m}`) }))} />
            <Field name="currency" label={t("suppliers.currency")} dir="ltr" maxLength={3} placeholder="SAR" />
            <div className="sm:col-span-2"><Field name="reason" label={t("ref.reason")} required /></div>
          </ApiForm>
        </section>
      )}
    </>
  );
}
