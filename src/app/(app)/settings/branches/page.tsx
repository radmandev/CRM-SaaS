import Link from "next/link";
import { ApiForm, Field } from "@/components/api-form";
import { ActionButton } from "@/components/actions";
import { EmptyState, NoPermission, PageHeader, Pager, SearchBox } from "@/components/ui";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { listBranches } from "@/modules/settings/service";
import { listQuery } from "@/lib/schemas";

export const metadata = { title: "Branches" };

export default async function BranchesPage({ searchParams }: { searchParams: Promise<{ q?: string; cursor?: string; archived?: string }> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "branch:manage")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const q = listQuery.parse({ q: sp.q || undefined, cursor: sp.cursor || undefined });
  const { data, page } = await listBranches(ctx, { ...q, includeArchived: sp.archived === "1" });
  const name = (b: { nameEn: string; nameAr: string | null }) => (locale === "ar" && b.nameAr) || b.nameEn;

  return (
    <>
      <PageHeader
        title={t("settings.branches.title")}
        description={t("settings.branches.subtitle")}
        actions={
          <Link className="btn-secondary" href={sp.archived === "1" ? "/settings/branches" : "/settings/branches?archived=1"}>
            {sp.archived === "1" ? t("settings.branches.hideArchived") : t("settings.branches.showArchived")}
          </Link>
        }
      />
      <SearchBox action="/settings/branches" defaultValue={sp.q} label={t("common.search")} />
      {data.length === 0 ? (
        <EmptyState title={sp.q ? t("common.noResults") : t("settings.branches.empty")} />
      ) : (
        <ul className="space-y-3">
          {data.map((b) => (
            <li key={b.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-semibold">{name(b)}</span> <span className="badge" dir="ltr">{b.code}</span>{" "}
                  {b.archivedAt && <span className="badge">{t("common.archived")}</span>}
                  {(b.phone || b.email) && <div className="text-sm text-muted" dir="ltr">{[b.phone, b.email].filter(Boolean).join(" · ")}</div>}
                </div>
                {b.archivedAt ? (
                  <ActionButton url={`/api/v1/branches/${b.id}/restore`} label={t("common.restore")} locale={locale} />
                ) : (
                  <ActionButton url={`/api/v1/branches/${b.id}/archive`} label={t("common.archive")} locale={locale} variant="danger" confirm={t("settings.branches.archiveConfirm")} />
                )}
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm underline">{t("common.edit")}</summary>
                <div className="mt-3">
                  <BranchForm locale={locale} t={t} action={`/api/v1/branches/${b.id}`} method="PATCH" values={b} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      <Pager basePath="/settings/branches" nextCursor={page.nextCursor} hasCursor={!!sp.cursor} params={{ q: sp.q, archived: sp.archived }} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />
      <section className="card mt-6" aria-labelledby="new-branch">
        <h2 id="new-branch" className="mb-4 font-semibold">{t("settings.branches.add")}</h2>
        <BranchForm locale={locale} t={t} action="/api/v1/branches" method="POST" reset />
      </section>
    </>
  );
}

function BranchForm({ locale, t, action, method, values, reset }: { locale: "ar" | "en"; t: (k: string) => string; action: string; method: "POST" | "PATCH"; values?: Record<string, unknown>; reset?: boolean }) {
  const v = (k: string) => (values?.[k] as string | null) ?? "";
  return (
    <ApiForm action={action} method={method} schema="branch" locale={locale} submitLabel={method === "POST" ? t("common.add") : t("common.save")} resetOnSuccess={reset} className="grid gap-4 sm:grid-cols-2">
      <Field name="code" label={t("field.branchCode")} defaultValue={v("code")} required dir="ltr" maxLength={10} hint={t("field.branchCodeHint")} />
      <Field name="nameEn" label={t("field.nameEn")} defaultValue={v("nameEn")} required dir="ltr" />
      <Field name="nameAr" label={t("field.nameAr")} defaultValue={v("nameAr")} dir="rtl" />
      <Field name="phone" type="tel" label={t("field.phone")} defaultValue={v("phone")} dir="ltr" />
      <Field name="email" type="email" label={t("field.email")} defaultValue={v("email")} dir="ltr" />
      <Field name="timezone" label={t("field.timezoneOverride")} defaultValue={v("timezone")} dir="ltr" placeholder="Asia/Riyadh" />
      <div className="sm:col-span-2">
        <Field name="address" label={t("field.address")} defaultValue={v("address")} multiline maxLength={300} />
      </div>
    </ApiForm>
  );
}
