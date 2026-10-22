import { ApiForm, Checkbox, Field } from "@/components/api-form";
import { NoPermission, PageHeader } from "@/components/ui";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { getFinanceSettings } from "@/modules/tenancy/service";

export const metadata = { title: "Finance settings" };

export default async function FinanceSettingsPage() {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "tenant:settings")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const s = await getFinanceSettings(ctx);
  return (
    <>
      <PageHeader title={t("finset.title")} description={t("finset.subtitle")} />
      <section className="card">
        <ApiForm action="/api/v1/agency/finance" method="PATCH" schema="financeSettings" locale={locale} submitLabel={t("common.save")} className="grid gap-4 sm:grid-cols-2">
          <Field name="discountApprovalPercent" label={t("finset.discountPercent")} defaultValue={s.discountApprovalPercent} dir="ltr" hint={t("finset.discountHint")} />
          <Field name="expenseApprovalLimit" label={t("finset.expenseLimit")} defaultValue={s.expenseApprovalLimit} dir="ltr" hint={t("finset.expenseHint")} />
          <Field name="quotationValidityDays" type="number" label={t("finset.validityDays")} defaultValue={String(s.quotationValidityDays)} dir="ltr" />
          <div className="self-end"><Checkbox name="refundSelfApproval" label={t("finset.selfApproval")} defaultChecked={s.refundSelfApproval} /></div>
          <div className="sm:col-span-2"><Field name="quotationTermsEn" label={t("finset.termsEn")} defaultValue={s.quotationTermsEn} multiline /></div>
          <div className="sm:col-span-2"><Field name="quotationTermsAr" label={t("finset.termsAr")} defaultValue={s.quotationTermsAr} multiline dir="rtl" /></div>
        </ApiForm>
      </section>
    </>
  );
}
