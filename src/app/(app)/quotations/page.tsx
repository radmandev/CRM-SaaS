import Link from "next/link";
import { ApiForm, Field } from "@/components/api-form";
import { EmptyState, Money, NoPermission, PageHeader, Pager, SearchBox, StatusBadge } from "@/components/ui";
import { can } from "@/server/context";
import { scopeWhere } from "@/server/scope";
import { pageCtx, pageT } from "@/server/page";
import { listQuotations } from "@/modules/sales/service";
import { listQuery } from "@/lib/schemas";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Quotations" };
const STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"];

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "quotation:read")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const { data, page } = await listQuotations(ctx, { ...listQuery.parse({ q: sp.q || undefined, cursor: sp.cursor || undefined }), status });
  const writable = can(ctx, "quotation:write");
  const customers = writable ? await ctx.db.customer.findMany({ where: { archivedAt: null, mergedIntoId: null, ...scopeWhere(ctx, "customer:read") }, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, code: true, displayName: true } }) : [];
  return (
    <>
      <PageHeader title={t("quote.title")} description={t("quote.subtitle")} />
      <SearchBox action="/quotations" defaultValue={sp.q} label={t("common.search")}>
        <select name="status" defaultValue={status ?? ""} className="input" aria-label={t("field.status")}>
          <option value="">{t("common.all")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`quoteStatus.${s}`)}</option>)}
        </select>
      </SearchBox>
      {data.length === 0 ? (
        <EmptyState title={sp.q || status ? t("common.noResults") : t("quote.empty")} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {data.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div>
                <Link href={`/quotations/${q.id}`} className="font-semibold hover:underline" dir="ltr">{q.number ?? t("quote.draftNumber")} v{q.versionNo}</Link> · {q.customer.displayName}
                <div className="text-sm text-muted">{t("quote.validUntil")}: {formatDate(q.validUntil!, locale)}{q.requiresApproval && !q.approvedAt ? ` · ${t("quote.needsApproval")}` : ""}</div>
              </div>
              <div className="flex items-center gap-3">
                <Money value={q.grandTotal.toString()} currency={q.currency} locale={locale} />
                <StatusBadge status={q.status === "SENT" ? "ON_HOLD" : q.status === "ACCEPTED" || q.status === "CONVERTED" ? "CONFIRMED" : q.status === "DRAFT" ? "DRAFT" : "CANCELLED"} label={t(`quoteStatus.${q.status}`)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager basePath="/quotations" nextCursor={page.nextCursor} hasCursor={!!sp.cursor} params={{ q: sp.q, status }} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />
      {writable && customers.length > 0 && (
        <section className="card mt-6" aria-labelledby="new-q">
          <h2 id="new-q" className="mb-4 font-semibold">{t("quote.new")}</h2>
          <ApiForm action="/api/v1/quotations" schema="quotationCreate" locale={locale} submitLabel={t("quote.create")} redirectToCreated="/quotations/{id}" className="grid gap-4 sm:grid-cols-3">
            <Field name="customerId" label={t("booking.customer")} options={customers.map((c) => ({ value: c.id, label: `${c.displayName} (${c.code})` }))} />
            <Field name="currency" label={t("suppliers.currency")} dir="ltr" maxLength={3} placeholder="SAR" />
            <Field name="validUntil" type="date" label={t("quote.validUntil")} hint={t("quote.validUntilHint")} />
          </ApiForm>
        </section>
      )}
    </>
  );
}
