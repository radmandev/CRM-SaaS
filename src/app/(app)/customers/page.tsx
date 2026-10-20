import Link from "next/link";
import { ApiForm, Checkbox, Field } from "@/components/api-form";
import { EmptyState, NoPermission, PageHeader, Pager, SearchBox } from "@/components/ui";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { listCustomers } from "@/modules/crm/service";
import { customerListQuery } from "@/lib/schemas-travel";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "customer:read")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const q = customerListQuery.safeParse({ q: sp.q || undefined, cursor: sp.cursor || undefined, stage: sp.stage || undefined, archived: sp.archived || undefined });
  const { data, page } = await listCustomers(ctx, q.success ? q.data : customerListQuery.parse({}));
  const writable = can(ctx, "customer:write");
  const branches = writable ? await ctx.db.branch.findMany({ where: { archivedAt: null }, orderBy: { code: "asc" } }) : [];
  return (
    <>
      <PageHeader title={t("crm.title")} description={t("crm.subtitle")} />
      <SearchBox action="/customers" defaultValue={sp.q} label={t("common.search")}>
        <label>
          <span className="sr-only">{t("crm.stage")}</span>
          <select name="stage" defaultValue={sp.stage ?? ""} className="input">
            <option value="">{t("common.all")}</option>
            {["LEAD", "ACTIVE", "INACTIVE"].map((s) => (
              <option key={s} value={s}>{t(`stage.${s}`)}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="archived" value="true" defaultChecked={sp.archived === "true"} />
          {t("common.archived")}
        </label>
      </SearchBox>
      {data.length === 0 ? (
        <EmptyState title={sp.q ? t("common.noResults") : t("crm.empty")} body={writable ? t("crm.emptyHint") : undefined} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <Link href={`/customers/${c.id}`} className="font-semibold underline-offset-2 hover:underline">
                  {(locale === "ar" && c.nameAr) || c.displayName}
                </Link>{" "}
                <span className="badge" dir="ltr">{c.code}</span> <span className="badge">{t(`customerType.${c.type}`)}</span>
                <div className="text-sm text-muted" dir="ltr">{[c.phone, c.email].filter(Boolean).join(" · ")}</div>
              </div>
              <span className="badge">{t(`stage.${c.lifecycleStage}`)}</span>
            </li>
          ))}
        </ul>
      )}
      <Pager basePath="/customers" nextCursor={page.nextCursor} hasCursor={!!sp.cursor} params={{ q: sp.q, stage: sp.stage, archived: sp.archived }} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />
      {writable && (
        <section className="card mt-6" aria-labelledby="new-customer">
          <h2 id="new-customer" className="mb-4 font-semibold">{t("crm.add")}</h2>
          <ApiForm action="/api/v1/customers" schema="customer" locale={locale} submitLabel={t("common.add")} duplicateHref="/customers/{id}" redirectToCreated="/customers/{id}" className="grid gap-4 sm:grid-cols-2">
            <Field name="type" label={t("crm.type")} options={["INDIVIDUAL", "CORPORATE"].map((v) => ({ value: v, label: t(`customerType.${v}`) }))} />
            <Field name="displayName" label={t("crm.companyName")} hint={t("crm.companyNameHint")} />
            <Field name="firstName" label={t("crm.firstName")} />
            <Field name="lastName" label={t("crm.lastName")} />
            <Field name="nameAr" label={t("field.nameAr")} dir="rtl" />
            <Field name="phone" type="tel" label={t("field.phone")} dir="ltr" />
            <Field name="email" type="email" label={t("field.email")} dir="ltr" />
            <Field name="branchId" label={t("field.branch")} options={branches.map((b) => ({ value: b.id, label: (locale === "ar" && b.nameAr) || b.nameEn }))} defaultValue={ctx.membership.primaryBranchId} />
            <Field name="source" label={t("crm.source")} options={[{ value: "", label: "—" }, ...["WALK_IN", "PHONE", "WEBSITE", "REFERRAL", "SOCIAL", "CORPORATE", "OTHER"].map((v) => ({ value: v, label: t(`source.${v}`) }))]} />
            <Field name="preferredLocale" label={t("field.language")} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} defaultValue={locale} />
            <Checkbox name="marketingConsent" label={t("crm.marketingConsent")} />
          </ApiForm>
        </section>
      )}
    </>
  );
}
