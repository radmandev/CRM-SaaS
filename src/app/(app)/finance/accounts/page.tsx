import { ApiForm, Field } from "@/components/api-form";
import { Money, NoPermission, PageHeader, TableScroll } from "@/components/ui";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { accountBalances } from "@/modules/finance/payables";

export const metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "report:financial")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const accounts = await accountBalances(ctx.db);
  const active = accounts.filter((a) => a.active);
  return (
    <>
      <PageHeader title={t("acct.title")} description={t("acct.subtitle")} />
      <TableScroll label={t("acct.title")}>
        <table className="table">
          <thead><tr><th scope="col">{t("field.name")}</th><th scope="col">{t("acct.type")}</th><th scope="col">IBAN</th><th scope="col">{t("acct.opening")}</th><th scope="col">{t("acct.balance")}</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className={a.active ? "" : "text-muted"}>
                <td>{a.name}</td><td>{t(`acctType.${a.type}`)}</td><td dir="ltr">{a.iban ?? "—"}</td>
                <td><Money value={a.openingBalance.toString()} currency={a.currency} locale={locale} /></td>
                <td className="font-semibold"><Money value={a.balance.toString()} currency={a.currency} locale={locale} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <p className="mt-2 text-xs text-muted">{t("acct.computedNote")}</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {can(ctx, "refund:approve") && active.length > 1 && (
          <section className="card" aria-labelledby="xfer">
            <h2 id="xfer" className="mb-4 font-semibold">{t("acct.transfer")}</h2>
            <ApiForm action="/api/v1/financial-accounts/transfers" schema="transfer" locale={locale} submitLabel={t("acct.transfer")} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
              <Field name="fromAccountId" label={t("acct.from")} options={active.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))} />
              <Field name="toAccountId" label={t("acct.to")} options={active.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))} defaultValue={active[1].id} />
              <Field name="amount" label={t("pay.amount")} dir="ltr" required />
              <Field name="fee" label={t("acct.fee")} defaultValue="0" dir="ltr" />
              <Field name="date" type="date" label={t("item.date")} defaultValue={new Date().toISOString().slice(0, 10)} required />
              <Field name="reference" label={t("pay.reference")} dir="ltr" />
            </ApiForm>
          </section>
        )}
        {can(ctx, "tenant:settings") && (
          <section className="card" aria-labelledby="new-acct">
            <h2 id="new-acct" className="mb-4 font-semibold">{t("acct.new")}</h2>
            {/* No client schema: the route also accepts an optional IBAN that the shared schema does not carry. */}
            <ApiForm action="/api/v1/financial-accounts" locale={locale} submitLabel={t("common.create")} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
              <Field name="name" label={t("field.name")} required />
              <Field name="type" label={t("acct.type")} options={["BANK", "CASH", "GATEWAY_CLEARING"].map((x) => ({ value: x, label: t(`acctType.${x}`) }))} />
              <Field name="currency" label={t("suppliers.currency")} defaultValue="SAR" dir="ltr" maxLength={3} required />
              <Field name="openingBalance" label={t("acct.opening")} defaultValue="0" dir="ltr" />
              <div className="sm:col-span-2"><Field name="iban" label="IBAN" dir="ltr" hint={t("acct.ibanHint")} /></div>
            </ApiForm>
          </section>
        )}
      </div>
    </>
  );
}
