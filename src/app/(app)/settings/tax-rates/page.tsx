import { ApiForm, Checkbox, Field } from "@/components/api-form";
import { NoPermission, PageHeader, TableScroll } from "@/components/ui";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { listTaxRates } from "@/modules/settings/service";

export const metadata = { title: "Tax rates" };
const CATEGORIES = ["STANDARD", "ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"] as const;

export default async function TaxRatesPage() {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "tenant:settings")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const { data } = await listTaxRates(ctx);
  const categoryOptions = CATEGORIES.map((c) => ({ value: c, label: t(`tax.${c}`) }));
  const form = (action: string, method: "POST" | "PATCH", v?: (typeof data)[number]) => (
    <ApiForm action={action} method={method} schema="taxRate" locale={locale} submitLabel={method === "POST" ? t("common.add") : t("common.save")} resetOnSuccess={method === "POST"} className="grid gap-4 sm:grid-cols-3">
      <Field name="code" label={t("field.code")} defaultValue={v?.code} required dir="ltr" />
      <Field name="nameEn" label={t("field.nameEn")} defaultValue={v?.nameEn} required dir="ltr" />
      <Field name="nameAr" label={t("field.nameAr")} defaultValue={v?.nameAr} required dir="rtl" />
      <Field name="rate" label={t("field.ratePercent")} defaultValue={v?.rate ?? "0"} required dir="ltr" />
      <Field name="category" label={t("field.category")} defaultValue={v?.category ?? "STANDARD"} options={categoryOptions} />
      <Field name="exemptionReasonCode" label={t("field.exemptionCode")} defaultValue={v?.exemptionReasonCode} dir="ltr" />
      <div className="sm:col-span-2">
        <Field name="exemptionReasonText" label={t("field.exemptionText")} defaultValue={v?.exemptionReasonText} />
      </div>
      <Checkbox name="active" label={t("common.active")} defaultChecked={v?.active ?? true} />
    </ApiForm>
  );
  return (
    <>
      <PageHeader title={t("settings.tax.title")} description={t("settings.tax.subtitle")} />
      <p role="note" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {t("settings.tax.reviewNote")}
      </p>
      <TableScroll label={t("settings.tax.title")}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t("field.code")}</th>
              <th scope="col">{t("field.name")}</th>
              <th scope="col">{t("field.ratePercent")}</th>
              <th scope="col">{t("field.category")}</th>
              <th scope="col">{t("field.status")}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id}>
                <td dir="ltr">{r.code}</td>
                <td>
                  {locale === "ar" ? r.nameAr : r.nameEn}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs underline">{t("common.edit")}</summary>
                    <div className="mt-2 min-w-[min(40rem,80vw)]">{form(`/api/v1/tax-rates/${r.id}`, "PATCH", r)}</div>
                  </details>
                </td>
                <td dir="ltr">{r.rate}%</td>
                <td>{t(`tax.${r.category}`)} <span className="text-muted">({r.zatcaCode})</span></td>
                <td>{r.active ? t("common.active") : t("common.inactive")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <section className="card mt-6" aria-labelledby="new-rate">
        <h2 id="new-rate" className="mb-4 font-semibold">{t("settings.tax.add")}</h2>
        {form("/api/v1/tax-rates", "POST")}
      </section>
    </>
  );
}
