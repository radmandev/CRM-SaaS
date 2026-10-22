import Link from "next/link";
import { ApiForm, Field } from "@/components/api-form";
import { EmptyState, Money, NoPermission, PageHeader, Pager, SearchBox, StatusBadge } from "@/components/ui";
import { ReverseForm } from "@/components/finance";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { listBills } from "@/modules/finance/payables";
import { listQuery } from "@/lib/schemas";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Supplier bills" };

export default async function SupplierBillsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "supplier:read")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const { data, page } = await listBills(ctx, { ...listQuery.parse({ q: sp.q || undefined, cursor: sp.cursor || undefined }), unpaid: sp.unpaid === "true" });
  const write = can(ctx, "supplierbill:write");
  const suppliers = write ? await ctx.db.supplier.findMany({ where: { archivedAt: null }, orderBy: { nameEn: "asc" }, take: 300, select: { id: true, code: true, nameEn: true, nameAr: true } }) : [];
  const name = (s: { nameEn: string; nameAr: string | null }) => (locale === "ar" && s.nameAr) || s.nameEn;
  return (
    <>
      <PageHeader title={t("bill.title")} description={t("bill.subtitle")} />
      <SearchBox action="/supplier-bills" defaultValue={sp.q} label={t("common.search")}>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="unpaid" value="true" defaultChecked={sp.unpaid === "true"} />{t("inv.unpaidOnly")}</label>
      </SearchBox>
      {data.length === 0 ? (
        <EmptyState title={t("common.noResults")} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {data.map((b) => (
            <li key={b.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-semibold" dir="ltr">{b.supplierInvoiceNumber}</span> · <Link className="hover:underline" href={`/suppliers/${b.supplier.id}`}>{name(b.supplier)}</Link>
                  <div className="text-sm text-muted">{formatDate(b.billDate!, locale)}{b.dueDate ? ` · ${t("inv.due")} ${formatDate(b.dueDate, locale)}` : ""}</div>
                  <ul className="mt-1 text-xs text-muted">
                    {b.lines.map((l) => (
                      <li key={l.id}>
                        {l.description} · <Money value={l.amount.toString()} currency={b.currency} locale={locale} />
                        {l.bookingItem && <> · <Link className="underline" href={`/bookings/${l.bookingItem.booking.id}`} dir="ltr">{l.bookingItem.booking.reference}</Link></>}
                        {l.variance && !l.variance.isZero() && <span className="ms-1 text-amber-800 dark:text-amber-300">({t("bill.variance")} <Money value={l.variance.toString()} currency={b.currency} locale={locale} />)</span>}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="text-end">
                  <Money value={b.total.toString()} currency={b.currency} locale={locale} />
                  {b.outstanding.greaterThan(0) && <div className="text-xs text-muted">{t("inv.outstanding")} <Money value={b.outstanding.toString()} currency={b.currency} locale={locale} /></div>}
                  <StatusBadge status={b.status === "RECORDED" ? (b.outstanding.greaterThan(0) ? "ON_HOLD" : "ISSUED") : "CANCELLED"} label={b.status === "RECORDED" ? (b.outstanding.greaterThan(0) ? t("inv.unpaid") : t("inv.paid")) : t(`recStatus.${b.status}`)} />
                </div>
              </div>
              {b.status === "RECORDED" && b.amountPaid.isZero() && write && <ReverseForm url={`/api/v1/supplier-bills/${b.id}/reverse`} locale={locale} t={t} />}
            </li>
          ))}
        </ul>
      )}
      <Pager basePath="/supplier-bills" nextCursor={page.nextCursor} hasCursor={!!sp.cursor} params={{ q: sp.q, unpaid: sp.unpaid }} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />
      {write && suppliers.length > 0 && (
        <section className="card mt-6" aria-labelledby="new-bill">
          <h2 id="new-bill" className="mb-1 font-semibold">{t("bill.record")}</h2>
          <p className="mb-4 text-xs text-muted">{t("bill.recordHint")}</p>
          <ApiForm action="/api/v1/supplier-bills" schema="supplierBill" locale={locale} submitLabel={t("bill.record")} resetOnSuccess className="grid gap-4 sm:grid-cols-3">
            <Field name="supplierId" label={t("item.supplier")} options={suppliers.map((s) => ({ value: s.id, label: `${name(s)} (${s.code})` }))} />
            <Field name="supplierInvoiceNumber" label={t("bill.supplierNumber")} dir="ltr" required />
            <Field name="billDate" type="date" label={t("bill.date")} defaultValue={new Date().toISOString().slice(0, 10)} required />
            <Field name="dueDate" type="date" label={t("inv.due")} />
            <Field name="currency" label={t("suppliers.currency")} dir="ltr" maxLength={3} placeholder="SAR" />
            <Field name="lines.0.description" label={t("inv.lineDescription")} required />
            <Field name="lines.0.amount" label={t("bill.amountExclVat")} dir="ltr" required />
            <Field name="lines.0.taxAmount" label={t("booking.tax")} defaultValue="0" dir="ltr" />
          </ApiForm>
        </section>
      )}
    </>
  );
}
