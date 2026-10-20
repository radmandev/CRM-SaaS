import Link from "next/link";
import { ApiForm, Field } from "@/components/api-form";
import { EmptyState, NoPermission, PageHeader, Pager, TableScroll } from "@/components/ui";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { listExchangeRates } from "@/modules/settings/service";
import { listQuery } from "@/lib/schemas";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Currencies" };

export default async function CurrenciesPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "tenant:settings")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const tenant = await ctx.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { baseCurrency: true, enabledCurrencies: true } });
  const rates = await listExchangeRates(ctx, listQuery.parse({ cursor: sp.cursor || undefined }));
  const options = tenant.enabledCurrencies.map((c) => ({ value: c, label: c }));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title={t("settings.currencies.title")} description={t("settings.currencies.subtitle")} />
      <section className="card mb-6">
        <p className="text-sm">
          {t("field.baseCurrency")}: <strong dir="ltr">{tenant.baseCurrency}</strong> · {t("field.enabledCurrencies")}: <bdi dir="ltr">{tenant.enabledCurrencies.join(", ")}</bdi>
        </p>
        <Link href="/settings/agency" className="mt-2 inline-block text-sm underline">
          {t("settings.currencies.changeInAgency")}
        </Link>
      </section>
      <h2 className="mb-3 font-semibold">{t("settings.currencies.rates")}</h2>
      {rates.data.length === 0 ? (
        <EmptyState title={t("settings.currencies.noRates")} />
      ) : (
        <TableScroll label={t("settings.currencies.rates")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("field.effectiveDate")}</th>
                <th scope="col">{t("field.pair")}</th>
                <th scope="col">{t("field.rate")}</th>
              </tr>
            </thead>
            <tbody>
              {rates.data.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.effectiveDate, locale)}</td>
                  <td dir="ltr">1 {r.fromCurrency} = </td>
                  <td dir="ltr">{r.rate} {r.toCurrency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      <Pager basePath="/settings/currencies" nextCursor={rates.page.nextCursor} hasCursor={!!sp.cursor} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />
      <section className="card mt-6" aria-labelledby="new-rate">
        <h2 id="new-rate" className="mb-4 font-semibold">{t("settings.currencies.addRate")}</h2>
        <ApiForm action="/api/v1/exchange-rates" schema="exchangeRate" locale={locale} submitLabel={t("common.add")} resetOnSuccess className="grid gap-4 sm:grid-cols-4">
          <Field name="fromCurrency" label={t("field.from")} options={options} defaultValue={options.find((o) => o.value !== tenant.baseCurrency)?.value} />
          <Field name="toCurrency" label={t("field.to")} options={options} defaultValue={tenant.baseCurrency} />
          <Field name="rate" label={t("field.rate")} required dir="ltr" />
          <Field name="effectiveDate" type="date" label={t("field.effectiveDate")} defaultValue={today} required />
        </ApiForm>
      </section>
    </>
  );
}
