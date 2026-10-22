import Link from "next/link";
import { ApiForm, Field } from "@/components/api-form";
import { ActionButton } from "@/components/actions";
import { EmptyState, Money, NoPermission, PageHeader, Pager, SearchBox, StatusBadge } from "@/components/ui";
import { MANUAL_METHODS, ReverseForm } from "@/components/finance";
import { can } from "@/server/context";
import { scopeWhere } from "@/server/scope";
import { pageCtx, pageT } from "@/server/page";
import { listPayments } from "@/modules/finance/payments";
import { listQuery } from "@/lib/schemas";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "invoice:read")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const { data, page } = await listPayments(ctx, listQuery.parse({ q: sp.q || undefined, cursor: sp.cursor || undefined }));
  const record = can(ctx, "payment:record");
  const reverse = can(ctx, "refund:approve");
  const [customers, accounts] = record
    ? await Promise.all([
        ctx.db.customer.findMany({ where: { archivedAt: null, mergedIntoId: null, ...scopeWhere(ctx, "customer:read") }, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, code: true, displayName: true } }),
        ctx.db.financialAccount.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      ])
    : [[], []];
  return (
    <>
      <PageHeader title={t("pay.title")} description={t("pay.subtitle")} />
      <SearchBox action="/payments" defaultValue={sp.q} label={t("common.search")} />
      {data.length === 0 ? (
        <EmptyState title={t("common.noResults")} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {data.map((p) => (
            <li key={p.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-semibold" dir="ltr">{p.number}</span> · <Link className="hover:underline" href={`/customers/${p.customer.id}`}>{p.customer.displayName}</Link>
                  {p.booking && <> · <Link className="underline" href={`/bookings/${p.booking.id}`} dir="ltr">{p.booking.reference}</Link></>}
                  <div className="text-sm text-muted">{formatDate(p.date!, locale)} · {t(`method.${p.method}`)} · {p.financialAccount.name}{p.reference ? ` · ${p.reference}` : ""}</div>
                  {p.allocations.length > 0 && <div className="text-xs text-muted">{t("pay.appliedTo")} {p.allocations.map((a) => `${a.invoice.number} (${a.amount.toFixed(2)})`).join(", ")}</div>}
                  {p.status === "RECORDED" && p.unallocated.greaterThan(0) && <div className="text-xs text-amber-800 dark:text-amber-300">{t("pay.unallocated")} <Money value={p.unallocated.toString()} currency={p.currency} locale={locale} /></div>}
                  {p.reversalReason && <div className="text-xs text-muted">{t("fin.reversed")}: {p.reversalReason}</div>}
                </div>
                <div className="flex items-center gap-3">
                  <Money value={p.amount.toString()} currency={p.currency} locale={locale} />
                  <StatusBadge status={p.status === "RECORDED" ? "CONFIRMED" : "CANCELLED"} label={t(`recStatus.${p.status}`)} />
                </div>
              </div>
              {p.status === "RECORDED" && (
                <div className="flex flex-wrap items-start gap-4">
                  <ActionButton url={`/api/v1/payments/${p.id}/pdf`} label={t("pay.receipt")} locale={locale} />
                  {reverse && <ReverseForm url={`/api/v1/payments/${p.id}/reverse`} locale={locale} t={t} />}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pager basePath="/payments" nextCursor={page.nextCursor} hasCursor={!!sp.cursor} params={{ q: sp.q }} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />
      {record && customers.length > 0 && accounts.length > 0 && (
        <section className="card mt-6" aria-labelledby="new-pay">
          <h2 id="new-pay" className="mb-1 font-semibold">{t("pay.record")}</h2>
          <p className="mb-4 text-xs text-muted">{t("pay.recordHint")}</p>
          <ApiForm action="/api/v1/payments" schema="payment" locale={locale} submitLabel={t("pay.record")} resetOnSuccess className="grid gap-4 sm:grid-cols-3">
            <Field name="customerId" label={t("booking.customer")} options={customers.map((c) => ({ value: c.id, label: `${c.displayName} (${c.code})` }))} />
            <Field name="amount" label={t("pay.amount")} dir="ltr" required />
            <Field name="date" type="date" label={t("item.date")} defaultValue={new Date().toISOString().slice(0, 10)} required />
            <Field name="method" label={t("pay.method")} options={MANUAL_METHODS.map((m) => ({ value: m, label: t(`method.${m}`) }))} />
            <Field name="financialAccountId" label={t("pay.account")} options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))} />
            <Field name="currency" label={t("suppliers.currency")} dir="ltr" maxLength={3} placeholder="SAR" />
            <Field name="reference" label={t("pay.reference")} dir="ltr" hint={t("pay.referenceHint")} />
          </ApiForm>
        </section>
      )}
    </>
  );
}
