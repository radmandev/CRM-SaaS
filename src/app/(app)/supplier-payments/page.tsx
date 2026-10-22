import Link from "next/link";
import { ApiForm, Field } from "@/components/api-form";
import { EmptyState, Money, NoPermission, PageHeader, Pager, StatusBadge } from "@/components/ui";
import { MANUAL_METHODS, ReverseForm } from "@/components/finance";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { listBills, listSupplierPayments } from "@/modules/finance/payables";
import { listQuery } from "@/lib/schemas";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Supplier payments" };

export default async function SupplierPaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "supplierpayment:write") || !can(ctx, "supplier:read")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const { data, page } = await listSupplierPayments(ctx, listQuery.parse({ cursor: sp.cursor || undefined }));
  const [suppliers, accounts, open] = await Promise.all([
    ctx.db.supplier.findMany({ where: { archivedAt: null }, orderBy: { nameEn: "asc" }, take: 300, select: { id: true, code: true, nameEn: true, nameAr: true } }),
    ctx.db.financialAccount.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    listBills(ctx, { ...listQuery.parse({ limit: "100" }), unpaid: true }),
  ]);
  const name = (s: { nameEn: string; nameAr: string | null }) => (locale === "ar" && s.nameAr) || s.nameEn;
  return (
    <>
      <PageHeader title={t("spay.title")} description={t("spay.subtitle")} />
      {data.length === 0 ? (
        <EmptyState title={t("common.noResults")} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {data.map((p) => (
            <li key={p.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-semibold" dir="ltr">{p.number}</span> · <Link className="hover:underline" href={`/suppliers/${p.supplier.id}`}>{name(p.supplier)}</Link>
                  <div className="text-sm text-muted">{formatDate(p.date!, locale)} · {t(`method.${p.method}`)} · {p.financialAccount.name}</div>
                  {p.allocations.length > 0 && <div className="text-xs text-muted">{t("pay.appliedTo")} {p.allocations.map((a) => `${a.bill.supplierInvoiceNumber} (${a.amount.toFixed(2)})`).join(", ")}</div>}
                  {p.reversalReason && <div className="text-xs text-muted">{t("fin.reversed")}: {p.reversalReason}</div>}
                </div>
                <div className="flex items-center gap-3">
                  <Money value={p.amount.toString()} currency={p.currency} locale={locale} />
                  <StatusBadge status={p.status === "RECORDED" ? "CONFIRMED" : "CANCELLED"} label={t(`recStatus.${p.status}`)} />
                </div>
              </div>
              {p.status === "RECORDED" && can(ctx, "refund:approve") && <ReverseForm url={`/api/v1/supplier-payments/${p.id}/reverse`} locale={locale} t={t} />}
            </li>
          ))}
        </ul>
      )}
      <Pager basePath="/supplier-payments" nextCursor={page.nextCursor} hasCursor={!!sp.cursor} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />
      {suppliers.length > 0 && accounts.length > 0 && (
        <section className="card mt-6" aria-labelledby="new-spay">
          <h2 id="new-spay" className="mb-4 font-semibold">{t("spay.record")}</h2>
          <ApiForm action="/api/v1/supplier-payments" schema="supplierPayment" locale={locale} submitLabel={t("spay.record")} resetOnSuccess className="grid gap-4 sm:grid-cols-3">
            <Field name="supplierId" label={t("item.supplier")} options={suppliers.map((s) => ({ value: s.id, label: `${name(s)} (${s.code})` }))} />
            <Field name="amount" label={t("pay.amount")} dir="ltr" required />
            <Field name="date" type="date" label={t("item.date")} defaultValue={new Date().toISOString().slice(0, 10)} required />
            <Field name="method" label={t("pay.method")} options={MANUAL_METHODS.map((m) => ({ value: m, label: t(`method.${m}`) }))} />
            <Field name="financialAccountId" label={t("pay.account")} options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))} />
            <Field name="currency" label={t("suppliers.currency")} dir="ltr" maxLength={3} placeholder="SAR" />
            <Field name="reference" label={t("pay.reference")} dir="ltr" />
            <Field name="allocations.0.billId" label={t("spay.applyToBill")} options={[{ value: "", label: "—" }, ...open.data.map((b) => ({ value: b.id, label: `${name(b.supplier)} · ${b.supplierInvoiceNumber} · ${b.outstanding.toFixed(2)} ${b.currency}` }))]} />
            <Field name="allocations.0.amount" label={t("pay.applyAmount")} dir="ltr" />
          </ApiForm>
        </section>
      )}
    </>
  );
}
