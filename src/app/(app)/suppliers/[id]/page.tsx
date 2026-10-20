import { notFound } from "next/navigation";
import { ApiForm, Checkbox, Field } from "@/components/api-form";
import { ActionButton } from "@/components/actions";
import { RevealButton } from "@/components/travel";
import { EmptyState, PageHeader } from "@/components/ui";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { pageCtx, pageT } from "@/server/page";
import { getSupplier } from "@/modules/suppliers/service";
import { SERVICE_TYPES, SUPPLIER_TYPES } from "@/lib/schemas-travel";
import { formatDate } from "@/lib/format";
import { SupplierFields } from "../supplier-fields";

export const metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  const s = await getSupplier(ctx, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const w = s.canWrite && !s.archivedAt;
  const types = SUPPLIER_TYPES.map((v) => ({ value: v, label: t(`supplierType.${v}`) }));
  return (
    <>
      <PageHeader
        title={(locale === "ar" && s.nameAr) || s.nameEn}
        description={`${s.code} · ${t(`supplierType.${s.type}`)}`}
        actions={
          s.canWrite &&
          (s.archivedAt ? (
            <ActionButton url={`/api/v1/suppliers/${s.id}/restore`} label={t("common.restore")} locale={locale} />
          ) : (
            <ActionButton url={`/api/v1/suppliers/${s.id}/archive`} label={t("common.archive")} locale={locale} variant="danger" confirm={t("suppliers.archiveConfirm")} />
          ))
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2" aria-labelledby="details">
          <h2 id="details" className="mb-4 font-semibold">{t("suppliers.details")}</h2>
          {s.iban && (
            <p className="mb-4 text-sm">
              {t("suppliers.iban")}: <bdi dir="ltr" className="font-mono">{s.iban}</bdi>{" "}
              {s.canWrite && <RevealButton url={`/api/v1/suppliers/${s.id}/reveal-iban`} locale={locale} field="iban" />}
            </p>
          )}
          {w ? <SupplierFields locale={locale} t={t} action={`/api/v1/suppliers/${s.id}`} method="PATCH" types={types} v={s} /> : <p className="text-sm text-muted">{[s.city, s.country, s.phone, s.email].filter(Boolean).join(" · ")}</p>}
        </section>
        <div className="space-y-6">
          <section className="card" aria-labelledby="contacts">
            <h2 id="contacts" className="mb-3 font-semibold">{t("crm.contacts")}</h2>
            {s.contacts.length === 0 && <EmptyState title={t("suppliers.noContacts")} />}
            <ul className="space-y-2 text-sm">
              {s.contacts.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{c.name} {c.isPrimary && <span className="badge">{t("crm.primary")}</span>} {c.role && <span className="badge">{t(`contactRole.${c.role}`)}</span>}</div>
                    <div className="text-muted" dir="ltr">{[c.phone, c.email].filter(Boolean).join(" · ")}</div>
                  </div>
                  {w && <ActionButton url={`/api/v1/suppliers/${s.id}/contacts/${c.id}`} method="DELETE" label={t("common.delete")} locale={locale} variant="danger" confirm={t("common.deleteConfirm")} />}
                </li>
              ))}
            </ul>
            {w && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm underline">{t("crm.addContact")}</summary>
                <ApiForm action={`/api/v1/suppliers/${s.id}/contacts`} schema="supplierContact" locale={locale} submitLabel={t("common.add")} resetOnSuccess className="mt-3 space-y-3">
                  <Field name="name" label={t("field.name")} required />
                  <Field name="role" label={t("suppliers.contactRole")} options={[{ value: "", label: "—" }, ...["RESERVATIONS", "ACCOUNTS", "SALES", "EMERGENCY", "OTHER"].map((r) => ({ value: r, label: t(`contactRole.${r}`) }))]} />
                  <Field name="phone" type="tel" label={t("field.phone")} dir="ltr" />
                  <Field name="email" type="email" label={t("field.email")} dir="ltr" />
                  <Checkbox name="isPrimary" label={t("crm.primary")} />
                </ApiForm>
              </details>
            )}
          </section>
          <section className="card" aria-labelledby="rules">
            <h2 id="rules" className="mb-1 font-semibold">{t("suppliers.commissionRules")}</h2>
            <p className="mb-3 text-xs text-muted">{t("suppliers.commissionHint")}</p>
            {s.commissionRules.length === 0 && <EmptyState title={t("suppliers.noRules")} />}
            <ul className="space-y-2 text-sm">
              {s.commissionRules.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-medium" dir="ltr">{r.ratePercent ? `${r.ratePercent.toString()}%` : `${r.fixedAmount?.toString()} ${r.currency}`}</span>{" "}
                    <span className="text-muted">
                      {r.serviceType ? t(`service.${r.serviceType}`) : t("suppliers.allServices")}
                      {r.product ? ` · ${r.product.code}` : ""}
                      {r.validFrom || r.validTo ? ` · ${r.validFrom ? formatDate(r.validFrom, locale) : "…"} – ${r.validTo ? formatDate(r.validTo, locale) : "…"}` : ""}
                    </span>
                  </div>
                  {w && <ActionButton url={`/api/v1/suppliers/${s.id}/commission-rules/${r.id}`} method="DELETE" label={t("common.delete")} locale={locale} variant="danger" confirm={t("common.deleteConfirm")} />}
                </li>
              ))}
            </ul>
            {w && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm underline">{t("suppliers.addRule")}</summary>
                <ApiForm action={`/api/v1/suppliers/${s.id}/commission-rules`} schema="commissionRule" locale={locale} submitLabel={t("common.add")} resetOnSuccess className="mt-3 space-y-3">
                  <Field name="kind" label={t("suppliers.ruleKind")} options={[{ value: "PERCENT", label: t("suppliers.percent") }, { value: "FIXED", label: t("suppliers.fixed") }]} />
                  <Field name="ratePercent" label={t("field.ratePercent")} dir="ltr" />
                  <Field name="fixedAmount" label={t("suppliers.fixedAmount")} dir="ltr" />
                  <Field name="currency" label={t("suppliers.currency")} dir="ltr" maxLength={3} />
                  <Field name="serviceType" label={t("item.serviceType")} options={[{ value: "", label: t("suppliers.allServices") }, ...SERVICE_TYPES.map((v) => ({ value: v, label: t(`service.${v}`) }))]} />
                  <Field name="validFrom" type="date" label={t("suppliers.validFrom")} />
                  <Field name="validTo" type="date" label={t("suppliers.validTo")} />
                </ApiForm>
              </details>
            )}
          </section>
        </div>
      </div>
      {!can(ctx, "supplier:write") && <p className="mt-4 text-sm text-muted">{t("common.readOnly")}</p>}
    </>
  );
}
