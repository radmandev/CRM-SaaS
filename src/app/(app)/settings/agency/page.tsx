import { ApiForm, Checkbox, Field, GroupError } from "@/components/api-form";
import { LogoUpload } from "@/components/actions";
import { NoPermission, PageHeader } from "@/components/ui";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { getAgency } from "@/modules/tenancy/service";

export const metadata = { title: "Agency" };

const COMMON_CURRENCIES = ["SAR", "USD", "EUR", "GBP", "AED", "KWD", "QAR", "BHD", "OMR", "EGP", "JOD", "TRY", "MYR", "IDR", "INR", "PKR"];

export default async function AgencyPage() {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "tenant:settings")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const a = await getAgency(ctx);
  const hasLogo = (await ctx.db.document.count({ where: { category: "LOGO" } })) > 0;
  const v = (k: keyof typeof a) => String(a[k] ?? "");
  const currencyNames = new Intl.DisplayNames([locale], { type: "currency" });
  const zones = Intl.supportedValuesOf("timeZone");
  const days = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + i))));
  const currencies = [...new Set([...COMMON_CURRENCIES, ...a.enabledCurrencies])];

  return (
    <>
      <PageHeader title={t("settings.agency.title")} description={t("settings.agency.subtitle")} />
      <div className="space-y-6">
        <section className="card" aria-labelledby="branding">
          <h2 id="branding" className="mb-4 font-semibold">{t("settings.agency.branding")}</h2>
          <LogoUpload locale={locale} hasLogo={hasLogo} />
        </section>
        <section className="card">
          <ApiForm action="/api/v1/agency" method="PATCH" schema="agency" locale={locale} submitLabel={t("common.save")}>
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 font-semibold">{t("settings.agency.profile")}</legend>
              <Field name="legalNameEn" label={t("field.legalNameEn")} defaultValue={v("legalNameEn")} required dir="ltr" />
              <Field name="legalNameAr" label={t("field.legalNameAr")} defaultValue={v("legalNameAr")} dir="rtl" />
              <Field name="tradeNameEn" label={t("field.tradeNameEn")} defaultValue={v("tradeNameEn")} dir="ltr" />
              <Field name="tradeNameAr" label={t("field.tradeNameAr")} defaultValue={v("tradeNameAr")} dir="rtl" />
              <Field name="phone" type="tel" label={t("field.phone")} defaultValue={v("phone")} dir="ltr" />
              <Field name="email" type="email" label={t("field.email")} defaultValue={v("email")} dir="ltr" />
              <Field name="website" type="url" label={t("field.website")} defaultValue={v("website")} dir="ltr" />
              <Field name="country" label={t("field.country")} defaultValue={v("country")} dir="ltr" maxLength={2} />
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 font-semibold">{t("settings.agency.legal")}</legend>
              <Field name="crNumber" label={t("field.crNumber")} defaultValue={v("crNumber")} dir="ltr" />
              <Field name="tourismLicenseNumber" label={t("field.tourismLicense")} defaultValue={v("tourismLicenseNumber")} dir="ltr" />
              <div className="sm:col-span-2">
                <Checkbox name="vatRegistered" label={t("field.vatRegistered")} defaultChecked={a.vatRegistered} />
              </div>
              <Field name="vatNumber" label={t("field.vatNumber")} defaultValue={v("vatNumber")} dir="ltr" hint={t("field.vatNumberHint")} />
              <Field name="vatRegisteredAt" type="date" label={t("field.vatRegisteredAt")} defaultValue={v("vatRegisteredAt")} />
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-3">
              <legend className="mb-2 font-semibold">{t("settings.agency.address")}</legend>
              <Field name="addressBuilding" label={t("field.building")} defaultValue={v("addressBuilding")} dir="ltr" />
              <Field name="addressStreet" label={t("field.street")} defaultValue={v("addressStreet")} />
              <Field name="addressDistrict" label={t("field.district")} defaultValue={v("addressDistrict")} />
              <Field name="addressCity" label={t("field.city")} defaultValue={v("addressCity")} />
              <Field name="addressPostalCode" label={t("field.postalCode")} defaultValue={v("addressPostalCode")} dir="ltr" />
              <Field name="addressAdditionalNumber" label={t("field.additionalNumber")} defaultValue={v("addressAdditionalNumber")} dir="ltr" />
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 font-semibold">{t("settings.agency.regional")}</legend>
              <Field name="baseCurrency" label={t("field.baseCurrency")} defaultValue={v("baseCurrency")} options={currencies.map((c) => ({ value: c, label: `${c} · ${currencyNames.of(c)}` }))} hint={t("field.baseCurrencyHint")} />
              <Field name="timezone" label={t("field.timezone")} defaultValue={v("timezone")} options={zones.map((z) => ({ value: z, label: z }))} />
              <Field name="defaultLocale" label={t("field.defaultLanguage")} defaultValue={v("defaultLocale")} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} />
              <Field name="weekStartsOn" label={t("field.weekStartsOn")} defaultValue={String(a.weekStartsOn)} options={days.map((d, i) => ({ value: String(i), label: d }))} />
              <div className="sm:col-span-2">
                <p className="mb-2 text-sm font-medium">{t("field.enabledCurrencies")}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {currencies.map((c) => (
                    <Checkbox key={c} name="enabledCurrencies" value={c} array label={c} defaultChecked={a.enabledCurrencies.includes(c)} />
                  ))}
                </div>
                <GroupError name="enabledCurrencies" />
              </div>
              <Checkbox name="showHijri" label={t("field.showHijri")} defaultChecked={a.showHijri} />
              <Checkbox name="pricesIncludeTax" label={t("field.pricesIncludeTax")} defaultChecked={a.pricesIncludeTax} />
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 font-semibold">{t("settings.agency.documents")}</legend>
              <Field name="primaryColor" type="color" label={t("field.primaryColor")} defaultValue={v("primaryColor")} hint={t("field.primaryColorHint")} />
              <div />
              <Field name="documentFooterEn" label={t("field.footerEn")} defaultValue={v("documentFooterEn")} multiline maxLength={500} dir="ltr" />
              <Field name="documentFooterAr" label={t("field.footerAr")} defaultValue={v("documentFooterAr")} multiline maxLength={500} dir="rtl" />
            </fieldset>
          </ApiForm>
        </section>
      </div>
    </>
  );
}
