import { ApiForm, Field } from "@/components/api-form";
import { ActionButton } from "@/components/actions";
import { EmptyState, Money, NoPermission, PageHeader, Pager, SearchBox, StatusBadge } from "@/components/ui";
import { ReverseForm } from "@/components/finance";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { listExpenses } from "@/modules/finance/payables";
import { getFinanceSettings } from "@/modules/tenancy/service";
import { listQuery } from "@/lib/schemas";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Expenses" };
const TONE: Record<string, string> = { RECORDED: "CONFIRMED", PENDING_APPROVAL: "ON_HOLD", REJECTED: "CANCELLED", REVERSED: "CANCELLED" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "expense:write")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const status = Object.keys(TONE).includes(sp.status ?? "") ? sp.status : undefined;
  const { data, page } = await listExpenses(ctx, { ...listQuery.parse({ q: sp.q || undefined, cursor: sp.cursor || undefined }), status });
  const approver = can(ctx, "refund:approve");
  const [categories, accounts, settings] = await Promise.all([
    ctx.db.expenseCategory.findMany({ where: { active: true }, orderBy: { nameEn: "asc" } }),
    ctx.db.financialAccount.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    getFinanceSettings(ctx),
  ]);
  return (
    <>
      <PageHeader title={t("exp.title")} description={t("exp.subtitle", { limit: String(settings.expenseApprovalLimit) })} />
      <SearchBox action="/expenses" defaultValue={sp.q} label={t("common.search")}>
        <select name="status" defaultValue={status ?? ""} className="input" aria-label={t("field.status")}>
          <option value="">{t("common.all")}</option>
          {Object.keys(TONE).map((s) => <option key={s} value={s}>{t(`expStatus.${s}`)}</option>)}
        </select>
      </SearchBox>
      {data.length === 0 ? (
        <EmptyState title={t("common.noResults")} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {data.map((e) => (
            <li key={e.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-semibold" dir="ltr">{e.number}</span> · {e.description}
                  <div className="text-sm text-muted">{formatDate(e.date!, locale)} · {locale === "ar" ? e.category.nameAr : e.category.nameEn} · {e.financialAccount.name}{e.payee ? ` · ${e.payee}` : ""}</div>
                  {e.reversalReason && <div className="text-xs text-muted">{t("fin.reversed")}: {e.reversalReason}</div>}
                </div>
                <div className="flex items-center gap-3">
                  <Money value={e.amount.toString()} currency={e.currency} locale={locale} />
                  <StatusBadge status={TONE[e.status]} label={t(`expStatus.${e.status}`)} />
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-3">
                {e.status === "PENDING_APPROVAL" && approver && <ActionButton url={`/api/v1/expenses/${e.id}/approve`} label={t("ref.approve")} locale={locale} />}
                {e.status === "PENDING_APPROVAL" && approver && <ActionButton url={`/api/v1/expenses/${e.id}/reject`} label={t("ref.reject")} locale={locale} variant="danger" />}
                {e.status === "RECORDED" && approver && <ReverseForm url={`/api/v1/expenses/${e.id}/reverse`} locale={locale} t={t} />}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager basePath="/expenses" nextCursor={page.nextCursor} hasCursor={!!sp.cursor} params={{ q: sp.q, status }} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />
      {categories.length > 0 && accounts.length > 0 && (
        <section className="card mt-6" aria-labelledby="new-exp">
          <h2 id="new-exp" className="mb-4 font-semibold">{t("exp.record")}</h2>
          <ApiForm action="/api/v1/expenses" schema="expense" locale={locale} submitLabel={t("exp.record")} resetOnSuccess className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2"><Field name="description" label={t("inv.lineDescription")} required /></div>
            <Field name="date" type="date" label={t("item.date")} defaultValue={new Date().toISOString().slice(0, 10)} required />
            <Field name="categoryId" label={t("exp.category")} options={categories.map((c) => ({ value: c.id, label: locale === "ar" ? c.nameAr : c.nameEn }))} />
            <Field name="amount" label={t("exp.amountInclVat")} dir="ltr" required />
            <Field name="taxAmount" label={t("exp.vatIncluded")} defaultValue="0" dir="ltr" />
            <Field name="financialAccountId" label={t("exp.paidFrom")} options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))} />
            <Field name="currency" label={t("suppliers.currency")} dir="ltr" maxLength={3} placeholder="SAR" />
            <Field name="payee" label={t("exp.payee")} />
          </ApiForm>
        </section>
      )}
    </>
  );
}
