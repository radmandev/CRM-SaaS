import Link from "next/link";
import { EmptyState, Money, PageHeader, Pager, SearchBox } from "@/components/ui";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { listProducts } from "@/modules/suppliers/service";
import { listQuery } from "@/lib/schemas";
import { ProductFields } from "./product-fields";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  const sp = await searchParams;
  const { data, page } = await listProducts(ctx, { ...listQuery.parse({ q: sp.q || undefined, cursor: sp.cursor || undefined }), includeInactive: true });
  const writable = can(ctx, "product:write");
  const [suppliers, taxRates, components] = writable
    ? await Promise.all([
        ctx.db.supplier.findMany({ where: { archivedAt: null }, orderBy: { nameEn: "asc" }, take: 300 }),
        ctx.db.taxRate.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
        ctx.db.product.findMany({ where: { active: true, type: { not: "PACKAGE" } }, orderBy: { code: "asc" }, take: 200 }),
      ])
    : [[], [], []];
  return (
    <>
      <PageHeader title={t("products.title")} description={t("products.subtitle")} />
      <SearchBox action="/products" defaultValue={sp.q} label={t("common.search")} />
      {data.length === 0 ? (
        <EmptyState title={sp.q ? t("common.noResults") : t("products.empty")} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <Link href={`/products/${p.id}`} className="font-semibold hover:underline">{(locale === "ar" && p.nameAr) || p.nameEn}</Link> <span className="badge" dir="ltr">{p.code}</span> <span className="badge">{t(`service.${p.type}`)}</span>
                {!p.active && <span className="badge ms-1">{t("common.inactive")}</span>}
              </div>
              <Money value={p.defaultSell.toString()} currency={p.currency} locale={locale} />
            </li>
          ))}
        </ul>
      )}
      <Pager basePath="/products" nextCursor={page.nextCursor} hasCursor={!!sp.cursor} params={{ q: sp.q }} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />
      {writable && (
        <section className="card mt-6" aria-labelledby="new-product">
          <h2 id="new-product" className="mb-4 font-semibold">{t("products.add")}</h2>
          <ProductFields locale={locale} t={t} action="/api/v1/products" method="POST" suppliers={suppliers.map((s) => ({ value: s.id, label: s.nameEn }))} taxRates={taxRates.map((r) => ({ value: r.id, label: locale === "ar" ? r.nameAr : r.nameEn }))} components={components.map((c) => ({ value: c.id, label: `${c.code} · ${c.nameEn}`, checked: false }))} />
        </section>
      )}
    </>
  );
}
