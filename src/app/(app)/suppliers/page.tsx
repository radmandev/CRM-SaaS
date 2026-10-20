import Link from "next/link";
import { EmptyState, NoPermission, PageHeader, Pager, SearchBox } from "@/components/ui";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { listSuppliers } from "@/modules/suppliers/service";
import { listQuery } from "@/lib/schemas";
import { SUPPLIER_TYPES } from "@/lib/schemas-travel";
import { SupplierFields } from "./supplier-fields";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "supplier:read")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const type = SUPPLIER_TYPES.find((x) => x === sp.type);
  const { data, page } = await listSuppliers(ctx, { ...listQuery.parse({ q: sp.q || undefined, cursor: sp.cursor || undefined }), type, archived: sp.archived === "true" });
  const types = SUPPLIER_TYPES.map((v) => ({ value: v, label: t(`supplierType.${v}`) }));
  return (
    <>
      <PageHeader title={t("suppliers.title")} description={t("suppliers.subtitle")} />
      <SearchBox action="/suppliers" defaultValue={sp.q} label={t("common.search")}>
        <label>
          <span className="sr-only">{t("suppliers.type")}</span>
          <select name="type" defaultValue={type ?? ""} className="input">
            <option value="">{t("common.all")}</option>
            {types.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </SearchBox>
      {data.length === 0 ? (
        <EmptyState title={sp.q ? t("common.noResults") : t("suppliers.empty")} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <Link href={`/suppliers/${s.id}`} className="font-semibold hover:underline">{(locale === "ar" && s.nameAr) || s.nameEn}</Link> <span className="badge" dir="ltr">{s.code}</span>
                <div className="text-sm text-muted" dir="ltr">{[s.city, s.country, s.phone, s.email].filter(Boolean).join(" · ")}</div>
              </div>
              <span className="badge">{t(`supplierType.${s.type}`)}</span>
            </li>
          ))}
        </ul>
      )}
      <Pager basePath="/suppliers" nextCursor={page.nextCursor} hasCursor={!!sp.cursor} params={{ q: sp.q, type }} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />
      {can(ctx, "supplier:write") && (
        <section className="card mt-6" aria-labelledby="new-supplier">
          <h2 id="new-supplier" className="mb-4 font-semibold">{t("suppliers.add")}</h2>
          <SupplierFields locale={locale} t={t} action="/api/v1/suppliers" method="POST" types={types} />
        </section>
      )}
    </>
  );
}
