import { ApiForm, Field } from "@/components/api-form";

export function SupplierFields({ locale, t, action, method, types, v }: { locale: "ar" | "en"; t: (k: string) => string; action: string; method: "POST" | "PATCH"; types: { value: string; label: string }[]; v?: Record<string, unknown> }) {
  const val = (k: string) => (v?.[k] as string | null | undefined) ?? null;
  return (
    <ApiForm action={action} method={method} schema="supplier" locale={locale} submitLabel={method === "POST" ? t("common.add") : t("common.save")} redirectToCreated={method === "POST" ? "/suppliers/{id}" : undefined} className="grid gap-4 sm:grid-cols-3">
      <Field name="type" label={t("suppliers.type")} options={types} defaultValue={val("type")} />
      <Field name="code" label={t("field.code")} defaultValue={val("code")} dir="ltr" required />
      <Field name="nameEn" label={t("field.nameEn")} defaultValue={val("nameEn")} dir="ltr" required />
      <Field name="nameAr" label={t("field.nameAr")} defaultValue={val("nameAr")} dir="rtl" />
      <Field name="country" label={t("field.country")} defaultValue={val("country")} dir="ltr" maxLength={2} />
      <Field name="city" label={t("field.city")} defaultValue={val("city")} />
      <Field name="phone" type="tel" label={t("field.phone")} defaultValue={val("phone")} dir="ltr" />
      <Field name="email" type="email" label={t("field.email")} defaultValue={val("email")} dir="ltr" />
      <Field name="website" type="url" label={t("field.website")} defaultValue={val("website")} dir="ltr" />
      <Field name="vatNumber" label={t("field.vatNumber")} defaultValue={val("vatNumber")} dir="ltr" />
      <Field name="defaultCurrency" label={t("suppliers.currency")} defaultValue={val("defaultCurrency") ?? "SAR"} dir="ltr" maxLength={3} />
      <Field name="paymentTermsDays" type="number" label={t("crm.paymentTerms")} defaultValue={(v?.paymentTermsDays as number) ?? 0} />
      <Field name="iban" label={t("suppliers.iban")} dir="ltr" hint={v?.iban ? `${t("suppliers.ibanStored")} ${v.iban as string}` : t("suppliers.ibanHint")} autoComplete="off" />
      <Field name="iataCode" label={t("suppliers.iata")} defaultValue={val("iataCode")} dir="ltr" maxLength={3} />
      <div className="sm:col-span-3"><Field name="notes" label={t("crm.notes")} defaultValue={val("notes")} multiline /></div>
    </ApiForm>
  );
}
