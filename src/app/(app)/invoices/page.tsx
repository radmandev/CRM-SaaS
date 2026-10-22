import Link from "next/link";
import { ApiForm, Field } from "@/components/api-form";
import { EmptyState, Money, NoPermission, PageHeader, Pager, SearchBox, StatusBadge } from "@/components/ui";
import { can } from "@/server/context";
import { scopeWhere } from "@/server/scope";
import { pageCtx, pageT } from "@/server/page";
import { listInvoices } from "@/modules/finance/invoices";
import { listQuery } from "@/lib/schemas";
import { formatDate } from "@/lib/format";
import { invoiceTone } from "@/components/finance";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "invoice:read")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const kind = sp.kind === "CREDIT_NOTE" ? "CREDIT_NOTE" : sp.kind === "INVOICE" ? "INVOICE" : undefined;
  const status = sp.status === "DRAFT" ? "DRAFT" : sp.status === "ISSUED" ? "ISSUED" : undefined;
  const { data, page } = await listInvoices(ctx, { ...listQuery.parse({ q: sp.q || undefined, cursor: sp.cursor || undefined }), kind, status, unpaid: sp.unpaid === "true" });
  const issue = can(ctx, "invoice:issue");
  const [customers, taxRates] = issue
    ? await Promise.all([
        ctx.db.customer.findMany({ where: { archivedAt: null, mergedIntoId: null, ...scopeWhere(ctx, "customer:read") }, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, code: true, displayName: true } }),
        ctx.db.taxRate.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
      ])
    : [[], []];
  return (
    <>
      <PageHeader title={t("inv.title")} description={t("inv.subtitle")} />
      <SearchBox action="/invoices" defaultValue={sp.q} label={t("common.search")}>
        <select name="kind" defaultValue={kind ?? ""} className="input" aria-label={t("inv.kind")}>
          <option value="">{t("common.all")}</option>
          <option value="INVOICE">{t("invKind.INVOICE")}</option>
          <option value="CREDIT_NOTE">{t("invKind.CREDIT_NOTE")}</option>
        </select>
        <select name="status" defaultValue={status ?? ""} className="input" aria-label={t("field.status")}>
          <option value="">{t("common.all")}</option>
          <option value="DRAFT">{t("invStatus.DRAFT")}</option>
          <option value="ISSUED">{t("invStatus.ISSUED")}</option>
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="unpaid" value="true" defaultChecked={sp.unpaid === "true"} />{t("inv.unpaidOnly")}</label>
      </SearchBox>
      {data.length === 0 ? (
        <EmptyState title={t("common.noResults")} body={issue ? t("inv.emptyHint") : undefined} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {data.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div>
                <Link href={`/invoices/${i.id}`} className="font-semibold hover:underline" dir="ltr">{i.number ?? t("invStatus.DRAFT")}</Link> <span className="badge">{t(`invKind.${i.kind}`)}</span> · {i.customer.displayName}
                <div className="text-sm text-muted">{i.issuedAt ? formatDate(i.issuedAt, locale) : "—"}{i.dueDate && i.kind === "INVOICE" ? ` · ${t("inv.due")} ${formatDate(i.dueDate, locale)}` : ""}</div>
              </div>
              <div className="flex items-center gap-3 text-end">
                <div>
                  <Money value={i.total.toString()} currency={i.currency} locale={locale} />
                  {i.outstanding && i.status === "ISSUED" && Number(i.outstanding) > 0 && <div className="text-xs text-muted">{t("inv.outstanding")} <Money value={i.outstanding.toString()} currency={i.currency} locale={locale} /></div>}
                </div>
                <StatusBadge status={invoiceTone(i)} label={i.status === "DRAFT" ? t("invStatus.DRAFT") : i.kind === "CREDIT_NOTE" ? t("invKind.CREDIT_NOTE") : Number(i.outstanding) <= 0 ? t("inv.paid") : t("inv.unpaid")} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager basePath="/invoices" nextCursor={page.nextCursor} hasCursor={!!sp.cursor} params={{ q: sp.q, kind, status, unpaid: sp.unpaid }} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />
      {issue && customers.length > 0 && (
        <section className="card mt-6" aria-labelledby="new-inv">
          <h2 id="new-inv" className="mb-1 font-semibold">{t("inv.newManual")}</h2>
          <p className="mb-4 text-xs text-muted">{t("inv.newManualHint")}</p>
          <ApiForm action="/api/v1/invoices" locale={locale} submitLabel={t("inv.createDraft")} redirectToCreated="/invoices/{id}" className="grid gap-4 sm:grid-cols-3">
            <Field name="customerId" label={t("booking.customer")} options={customers.map((c) => ({ value: c.id, label: `${c.displayName} (${c.code})` }))} />
            <Field name="currency" label={t("suppliers.currency")} dir="ltr" maxLength={3} placeholder="SAR" />
            <Field name="lines.0.descriptionEn" label={t("inv.lineDescription")} required />
            <Field name="lines.0.unitPrice" label={t("inv.unitPrice")} dir="ltr" required />
            <input type="hidden" name="lines.0.discount" value="0" />
            <Field name="lines.0.taxRateId" label={t("item.taxRate")} options={[{ value: "", label: "—" }, ...taxRates.map((r) => ({ value: r.id, label: locale === "ar" ? r.nameAr : r.nameEn }))]} defaultValue={taxRates.find((r) => r.category === "STANDARD")?.id} />
          </ApiForm>
        </section>
      )}
    </>
  );
}
