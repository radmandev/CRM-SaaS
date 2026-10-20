import { ApiForm, Field } from "@/components/api-form";
import { NoPermission, PageHeader } from "@/components/ui";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { getNumbering } from "@/modules/tenancy/service";

export const metadata = { title: "Numbering" };

export default async function NumberingPage() {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "tenant:settings")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const n = await getNumbering(ctx.db, ctx.tenant.id);
  const year = new Date().getFullYear();
  return (
    <>
      <PageHeader title={t("settings.numbering.title")} description={t("settings.numbering.subtitle")} />
      <section className="card">
        <ApiForm action="/api/v1/agency/numbering" method="PATCH" schema="numbering" locale={locale} submitLabel={t("common.save")} className="grid gap-4 sm:grid-cols-2">
          {n.series.map((s) => {
            const locked = n.locked.includes(s);
            const prefix = n.prefixes[s];
            return (
              <Field
                key={s}
                name={`prefixes.${s}`}
                label={t(`series.${s}`)}
                defaultValue={prefix}
                dir="ltr"
                maxLength={6}
                disabled={locked}
                hint={`${t("settings.numbering.example")}: ${prefix}-${year}-000001${locked ? ` · ${t("settings.numbering.locked")}` : ""}`}
              />
            );
          })}
        </ApiForm>
      </section>
    </>
  );
}
