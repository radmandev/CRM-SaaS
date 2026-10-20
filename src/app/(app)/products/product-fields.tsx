import { ApiForm, Checkbox, Field } from "@/components/api-form";
import { SERVICE_TYPES } from "@/lib/schemas-travel";

type Opt = { value: string; label: string };

export function ProductFields({ locale, t, action, method, v, suppliers, taxRates, components }: {
  locale: "ar" | "en"; t: (k: string) => string; action: string; method: "POST" | "PATCH"; v?: Record<string, unknown>;
  suppliers: Opt[]; taxRates: Opt[]; components: (Opt & { checked: boolean })[];
}) {
  const val = (k: string) => (v?.[k] as string | null | undefined) ?? null;
  return (
    <ApiForm action={action} method={method} schema="product" locale={locale} submitLabel={method === "POST" ? t("common.add") : t("common.save")} redirectToCreated={method === "POST" ? "/products/{id}" : undefined} className="grid gap-4 sm:grid-cols-3">
      <Field name="type" label={t("item.serviceType")} options={SERVICE_TYPES.filter((s) => s !== "FLIGHT").map((s) => ({ value: s, label: t(`service.${s}`) }))} defaultValue={val("type")} />
      <Field name="code" label={t("field.code")} defaultValue={val("code")} dir="ltr" required />
      <Field name="nameEn" label={t("field.nameEn")} defaultValue={val("nameEn")} dir="ltr" required />
      <Field name="nameAr" label={t("field.nameAr")} defaultValue={val("nameAr")} dir="rtl" />
      <Field name="defaultSupplierId" label={t("products.defaultSupplier")} options={[{ value: "", label: "—" }, ...suppliers]} defaultValue={val("defaultSupplierId")} />
      <Field name="currency" label={t("suppliers.currency")} defaultValue={val("currency") ?? "SAR"} dir="ltr" maxLength={3} />
      <Field name="defaultCost" label={t("item.cost")} defaultValue={v?.defaultCost?.toString() ?? "0"} dir="ltr" />
      <Field name="defaultSell" label={t("item.sell")} defaultValue={v?.defaultSell?.toString() ?? "0"} dir="ltr" />
      <Field name="taxRateId" label={t("item.taxRate")} options={[{ value: "", label: "—" }, ...taxRates]} defaultValue={val("taxRateId")} />
      <Field name="pricingModel" label={t("item.pricingModel")} options={["NET", "COMMISSIONABLE"].map((p) => ({ value: p, label: t(`pricing.${p}`) }))} defaultValue={val("pricingModel")} />
      <Field name="validFrom" type="date" label={t("suppliers.validFrom")} defaultValue={val("validFrom")} />
      <Field name="validTo" type="date" label={t("suppliers.validTo")} defaultValue={val("validTo")} />
      <div className="sm:col-span-3"><Field name="descriptionEn" label={t("products.descriptionEn")} defaultValue={val("descriptionEn")} multiline dir="ltr" /></div>
      <div className="sm:col-span-3"><Field name="descriptionAr" label={t("products.descriptionAr")} defaultValue={val("descriptionAr")} multiline dir="rtl" /></div>
      {components.length > 0 && (
        <fieldset className="sm:col-span-3">
          <legend className="mb-2 text-sm font-medium">{t("products.components")}</legend>
          <p className="mb-2 text-xs text-muted">{t("products.componentsHint")}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {components.map((c) => <Checkbox key={c.value} name="components" value={c.value} array label={c.label} defaultChecked={c.checked} />)}
          </div>
        </fieldset>
      )}
      <Checkbox name="active" label={t("common.active")} defaultChecked={v ? (v.active as boolean) : true} />
    </ApiForm>
  );
}
