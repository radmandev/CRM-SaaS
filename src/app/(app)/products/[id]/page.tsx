import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { AppError } from "@/server/errors";
import { pageCtx, pageT } from "@/server/page";
import { getProduct } from "@/modules/suppliers/service";
import { ProductFields } from "../product-fields";

export const metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  const p = await getProduct(ctx, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const [suppliers, taxRates, candidates] = await Promise.all([
    ctx.db.supplier.findMany({ where: { archivedAt: null }, orderBy: { nameEn: "asc" }, take: 300 }),
    ctx.db.taxRate.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    p.type === "PACKAGE" ? ctx.db.product.findMany({ where: { active: true, type: { not: "PACKAGE" } }, orderBy: { code: "asc" }, take: 200 }) : Promise.resolve([]),
  ]);
  const selected = new Set(p.components.map((c) => c.componentProductId));
  return (
    <>
      <PageHeader title={(locale === "ar" && p.nameAr) || p.nameEn} description={`${p.code} · ${t(`service.${p.type}`)}`} />
      <section className="card">
        {p.canWrite ? (
          <ProductFields locale={locale} t={t} action={`/api/v1/products/${p.id}`} method="PATCH" v={p} suppliers={suppliers.map((s) => ({ value: s.id, label: s.nameEn }))} taxRates={taxRates.map((r) => ({ value: r.id, label: locale === "ar" ? r.nameAr : r.nameEn }))} components={candidates.map((c) => ({ value: c.id, label: `${c.code} · ${c.nameEn}`, checked: selected.has(c.id) }))} />
        ) : (
          <p className="text-sm">{(locale === "ar" && p.descriptionAr) || p.descriptionEn || "—"}</p>
        )}
      </section>
    </>
  );
}
