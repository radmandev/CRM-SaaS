import Link from "next/link";
import { ApiForm, Field } from "@/components/api-form";
import { EmptyState, Money, NoPermission, PageHeader, Pager, SearchBox, StatusBadge } from "@/components/ui";
import { can } from "@/server/context";
import { scopeWhere } from "@/server/scope";
import { pageCtx, pageT } from "@/server/page";
import { listBookings } from "@/modules/bookings/service";
import { bookingListQuery } from "@/lib/schemas-travel";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Bookings" };
const STATUSES = ["DRAFT", "ON_HOLD", "CONFIRMED", "ISSUED", "COMPLETED", "CANCELLED"];

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "booking:read")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const parsed = bookingListQuery.safeParse({ q: sp.q || undefined, cursor: sp.cursor || undefined, status: sp.status || undefined, travelFrom: sp.travelFrom || undefined, travelTo: sp.travelTo || undefined });
  const q = parsed.success ? parsed.data : bookingListQuery.parse({});
  const { data, page } = await listBookings(ctx, q);
  const writable = can(ctx, "booking:write");
  const customers = writable
    ? await ctx.db.customer.findMany({ where: { archivedAt: null, mergedIntoId: null, ...scopeWhere(ctx, "customer:read") }, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, code: true, displayName: true } })
    : [];
  return (
    <>
      <PageHeader title={t("booking.title")} description={t("booking.subtitle")} />
      <SearchBox action="/bookings" defaultValue={sp.q} label={t("booking.searchHint")}>
        <label>
          <span className="sr-only">{t("field.status")}</span>
          <select name="status" defaultValue={q.status ?? ""} className="input">
            <option value="">{t("common.all")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`bookingStatus.${s}`)}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted">{t("booking.travelFrom")}</span>
          <input type="date" name="travelFrom" defaultValue={q.travelFrom} className="input" />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted">{t("booking.travelTo")}</span>
          <input type="date" name="travelTo" defaultValue={q.travelTo} className="input" />
        </label>
      </SearchBox>
      {data.length === 0 ? (
        <EmptyState title={sp.q || q.status ? t("common.noResults") : t("booking.empty")} body={writable ? t("booking.emptyHint") : undefined} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {data.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div>
                <Link href={`/bookings/${b.id}`} className="font-semibold hover:underline" dir="ltr">{b.reference}</Link> · <span>{b.customer.displayName}</span>
                <div className="text-sm text-muted">
                  {b.travelStartDate ? `${formatDate(b.travelStartDate, locale)} – ${formatDate(b.travelEndDate!, locale)}` : t("booking.noDates")} · {b.destinationSummary ?? "—"}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Money value={b.grandTotal.toString()} currency={b.currency} locale={locale} />
                <StatusBadge status={b.status} label={t(`bookingStatus.${b.status}`)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager basePath="/bookings" nextCursor={page.nextCursor} hasCursor={!!sp.cursor} params={{ q: sp.q, status: q.status, travelFrom: q.travelFrom, travelTo: q.travelTo }} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />
      {writable && (
        <section className="card mt-6" aria-labelledby="new-booking">
          <h2 id="new-booking" className="mb-4 font-semibold">{t("booking.new")}</h2>
          {customers.length === 0 ? (
            <p className="text-sm text-muted">{t("booking.needCustomer")} <Link href="/customers" className="underline">{t("crm.title")}</Link></p>
          ) : (
            <ApiForm action="/api/v1/bookings" schema="bookingCreate" locale={locale} submitLabel={t("booking.create")} duplicateHref="/bookings/{id}" redirectToCreated="/bookings/{id}" className="grid gap-4 sm:grid-cols-3">
              <Field name="customerId" label={t("booking.customer")} options={customers.map((c) => ({ value: c.id, label: `${c.displayName} (${c.code})` }))} />
              <Field name="currency" label={t("suppliers.currency")} dir="ltr" maxLength={3} placeholder="SAR" />
              <Field name="notes" label={t("booking.internalNotes")} />
            </ApiForm>
          )}
        </section>
      )}
    </>
  );
}
