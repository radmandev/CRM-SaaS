import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiForm, Checkbox, Field } from "@/components/api-form";
import { ActionButton } from "@/components/actions";
import { RevealButton } from "@/components/travel";
import { EmptyState, Money, PageHeader, StatusBadge, TableScroll } from "@/components/ui";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { pageCtx, pageT } from "@/server/page";
import { customerTimeline, getCustomer } from "@/modules/crm/service";
import { listBookings } from "@/modules/bookings/service";
import { formatDate, formatDateTime } from "@/lib/format";
import { expiresWithin } from "@/lib/travel";
import { customerBalances } from "@/modules/finance/common";
import { customerStatement } from "@/modules/finance/reports";
import { statementQuery } from "@/lib/schemas-finance";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  const c = await getCustomer(ctx, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const [timeline, bookings, branches] = await Promise.all([
    customerTimeline(ctx, id, 30),
    can(ctx, "booking:read") ? listBookings(ctx, { customerId: id, limit: 20 }) : Promise.resolve({ data: [] }),
    ctx.db.branch.findMany({ where: { archivedAt: null }, orderBy: { code: "asc" } }),
  ]);
  const finance = can(ctx, "invoice:read");
  const balances = finance ? await customerBalances(ctx.db, id) : [];
  // FIN-05: statement for a period in one currency, opened from the balance card.
  const st = finance && sp.from && sp.to ? statementQuery.safeParse({ from: sp.from, to: sp.to }) : null;
  const statement = st?.success ? await customerStatement(ctx, id, st.data.from, st.data.to, sp.currency || balances[0]?.currency || "SAR") : null;
  const w = c.canWrite && !c.archivedAt;
  const today = new Date().toISOString().slice(0, 10);
  const opts = (keys: string[], prefix: string) => keys.map((v) => ({ value: v, label: t(`${prefix}.${v}`) }));

  return (
    <>
      <PageHeader
        title={(locale === "ar" && c.nameAr) || c.displayName}
        description={`${c.code} · ${t(`customerType.${c.type}`)} · ${t(`stage.${c.lifecycleStage}`)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {w && can(ctx, "booking:write") && (
              <ApiForm action="/api/v1/bookings" schema="bookingCreate" locale={locale} submitLabel={t("booking.new")} extra={{ customerId: c.id }} duplicateHref="/bookings/{id}" redirectToCreated="/bookings/{id}" className="flex">
                <span />
              </ApiForm>
            )}
            {c.canWrite && !c.mergedIntoId &&
              (c.archivedAt ? (
                <ActionButton url={`/api/v1/customers/${c.id}/restore`} label={t("common.restore")} locale={locale} />
              ) : (
                <ActionButton url={`/api/v1/customers/${c.id}/archive`} label={t("common.archive")} locale={locale} variant="danger" confirm={t("crm.archiveConfirm")} />
              ))}
          </div>
        }
      />
      {c.mergedInto && (
        <p role="note" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {t("crm.mergedInto")} <Link className="underline" href={`/customers/${c.mergedInto.id}`}>{c.mergedInto.displayName} ({c.mergedInto.code})</Link>
        </p>
      )}
      {c.duplicates.length > 0 && w && (
        <section className="card mb-6 border-amber-300" aria-labelledby="dups">
          <h2 id="dups" className="mb-2 font-semibold">{t("crm.possibleDuplicates")}</h2>
          <ul className="space-y-2">
            {c.duplicates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <Link className="underline" href={`/customers/${d.id}`}>{d.displayName} ({d.code})</Link>
                {["OWNER", "ADMIN", "BRANCH_MANAGER"].includes(ctx.membership.role) && (
                  <ActionButton url={`/api/v1/customers/${c.id}/merge`} body={{ intoCustomerId: d.id }} label={t("crm.mergeInto")} locale={locale} variant="danger" confirm={t("crm.mergeConfirm", { from: c.code, into: d.code })} />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <section className="card" aria-labelledby="profile">
            <h2 id="profile" className="mb-4 font-semibold">{t("crm.profile")}</h2>
            {!w ? (
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {[
                  [t("field.phone"), c.phone],
                  [t("field.email"), c.email],
                  [t("crm.nationality"), c.nationality],
                  [t("crm.dateOfBirth"), c.dateOfBirth && formatDate(c.dateOfBirth, locale)],
                  [t("field.vatNumber"), c.vatNumber],
                  [t("crm.tags"), c.tags.join(", ")],
                  [t("field.address"), c.address],
                  [t("crm.notes"), c.notes],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <dt className="text-muted">{k}</dt>
                    <dd>{v || "—"}</dd>
                  </div>
                ))}
              </dl>
            ) : (
            <ApiForm action={`/api/v1/customers/${c.id}`} method="PATCH" schema="customerUpdate" locale={locale} submitLabel={t("common.save")} extra={{ version: c.version }} className="grid gap-4 sm:grid-cols-2">
              <Field name="type" label={t("crm.type")} options={opts(["INDIVIDUAL", "CORPORATE"], "customerType")} defaultValue={c.type} />
              {c.type === "CORPORATE" ? <Field name="displayName" label={t("crm.companyName")} defaultValue={c.displayName} /> : <span />}
              <Field name="firstName" label={t("crm.firstName")} defaultValue={c.firstName} />
              <Field name="lastName" label={t("crm.lastName")} defaultValue={c.lastName} />
              <Field name="nameAr" label={t("field.nameAr")} defaultValue={c.nameAr} dir="rtl" />
              <Field name="code" label={t("field.code")} defaultValue={c.code} dir="ltr" />
              <Field name="phone" type="tel" label={t("field.phone")} defaultValue={c.phone} dir="ltr" />
              <Field name="email" type="email" label={t("field.email")} defaultValue={c.email} dir="ltr" />
              <Field name="lifecycleStage" label={t("crm.stage")} options={opts(["LEAD", "ACTIVE", "INACTIVE"], "stage")} defaultValue={c.lifecycleStage} />
              <Field name="branchId" label={t("field.branch")} options={branches.map((b) => ({ value: b.id, label: (locale === "ar" && b.nameAr) || b.nameEn }))} defaultValue={c.branchId} />
              <Field name="nationality" label={t("crm.nationality")} defaultValue={c.nationality} dir="ltr" maxLength={2} />
              <Field name="dateOfBirth" type="date" label={t("crm.dateOfBirth")} defaultValue={c.dateOfBirth} />
              <Field name="vatNumber" label={t("field.vatNumber")} defaultValue={c.vatNumber} dir="ltr" />
              <Field name="paymentTermsDays" type="number" label={t("crm.paymentTerms")} defaultValue={c.paymentTermsDays} />
              <Field name="tags" label={t("crm.tags")} defaultValue={c.tags.join(", ")} hint={t("crm.tagsHint")} />
              <Field name="preferredLocale" label={t("field.language")} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} defaultValue={c.preferredLocale} />
              <div className="sm:col-span-2"><Field name="address" label={t("field.address")} defaultValue={c.address} multiline /></div>
              <div className="sm:col-span-2"><Field name="notes" label={t("crm.notes")} defaultValue={c.notes} multiline /></div>
              <Checkbox name="marketingConsent" label={t("crm.marketingConsent")} defaultChecked={!!c.marketingConsentAt} />
            </ApiForm>
            )}
          </section>

          <section className="card" aria-labelledby="travelers">
            <h2 id="travelers" className="mb-4 font-semibold">{t("crm.travelers")}</h2>
            {c.travelers.length === 0 && <EmptyState title={t("crm.noTravelers")} />}
            <ul className="space-y-4">
              {c.travelers.map((tr) => (
                <li key={tr.id} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold" dir="ltr">{[tr.title, tr.firstName, tr.middleName, tr.lastName].filter(Boolean).join(" ")}</span>
                      {tr.nameAr && <span className="ms-2 text-muted">{tr.nameAr}</span>}
                      <div className="text-xs text-muted">{[tr.dateOfBirth && formatDate(tr.dateOfBirth, locale), tr.nationality].filter(Boolean).join(" · ")}</div>
                    </div>
                    {w && <ActionButton url={`/api/v1/travelers/${tr.id}/archive`} label={t("common.archive")} locale={locale} variant="danger" confirm={t("crm.archiveTravelerConfirm")} />}
                  </div>
                  {tr.documents === null ? (
                    <p className="mt-2 text-xs text-muted">{t("crm.documentsHidden")}</p>
                  ) : (
                    <ul className="mt-3 space-y-1 text-sm">
                      {tr.documents.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-2">
                          <span className="badge">{t(`doc.${d.type}`)}</span>
                          <bdi dir="ltr" className="font-mono">{d.number}</bdi>
                          {can(ctx, "traveldoc:reveal") && <RevealButton url={`/api/v1/travel-documents/${d.id}/reveal`} locale={locale} />}
                          {d.expiryDate && (
                            <span className={expiresWithin(d.expiryDate, today) ? "text-red-700 dark:text-red-400" : "text-muted"}>
                              {t("crm.expires", { date: formatDate(d.expiryDate, locale) })}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {w && tr.documents !== null && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm underline">{t("crm.addDocument")}</summary>
                      <ApiForm action={`/api/v1/travelers/${tr.id}/documents`} schema="travelDocument" locale={locale} submitLabel={t("common.add")} resetOnSuccess className="mt-3 grid gap-3 sm:grid-cols-3">
                        <Field name="type" label={t("crm.docType")} options={opts(["PASSPORT", "NATIONAL_ID", "IQAMA", "VISA", "OTHER"], "doc")} />
                        <Field name="number" label={t("crm.docNumber")} dir="ltr" required autoComplete="off" />
                        <Field name="issuingCountry" label={t("crm.issuingCountry")} dir="ltr" maxLength={2} />
                        <Field name="issueDate" type="date" label={t("crm.issueDate")} />
                        <Field name="expiryDate" type="date" label={t("crm.expiryDate")} />
                        <Field name="holderName" label={t("crm.holderName")} dir="ltr" />
                      </ApiForm>
                    </details>
                  )}
                </li>
              ))}
            </ul>
            {w && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium underline">{t("crm.addTraveler")}</summary>
                <ApiForm action={`/api/v1/customers/${c.id}/travelers`} schema="traveler" locale={locale} submitLabel={t("common.add")} resetOnSuccess className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field name="title" label={t("crm.title2")} options={[{ value: "", label: "—" }, ...["MR", "MRS", "MS", "MSTR", "MISS"].map((v) => ({ value: v, label: v }))]} />
                  <Field name="firstName" label={t("crm.firstNameLatin")} dir="ltr" required />
                  <Field name="lastName" label={t("crm.lastNameLatin")} dir="ltr" required />
                  <Field name="middleName" label={t("crm.middleName")} dir="ltr" />
                  <Field name="nameAr" label={t("field.nameAr")} dir="rtl" />
                  <Field name="gender" label={t("crm.gender")} options={[{ value: "", label: "—" }, { value: "M", label: t("gender.M") }, { value: "F", label: t("gender.F") }]} />
                  <Field name="dateOfBirth" type="date" label={t("crm.dateOfBirth")} />
                  <Field name="nationality" label={t("crm.nationality")} dir="ltr" maxLength={2} />
                  <Field name="phone" type="tel" label={t("field.phone")} dir="ltr" />
                </ApiForm>
              </details>
            )}
          </section>

          <section className="card" aria-labelledby="bookings">
            <h2 id="bookings" className="mb-3 font-semibold">{t("nav.bookings")}</h2>
            {bookings.data.length === 0 ? (
              <EmptyState title={t("booking.empty")} />
            ) : (
              <ul className="divide-y divide-line text-sm">
                {bookings.data.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/bookings/${b.id}`} className="font-medium underline" dir="ltr">{b.reference}</Link>
                    <span className="text-muted">{b.travelStartDate ? formatDate(b.travelStartDate, locale) : "—"} · {b.destinationSummary ?? "—"}</span>
                    <StatusBadge status={b.status} label={t(`bookingStatus.${b.status}`)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {finance && (
            <section className="card space-y-3" aria-labelledby="balance">
              <h2 id="balance" className="font-semibold">{t("crm.balance")}</h2>
              {balances.length === 0 ? <p className="text-sm text-muted">{t("crm.noFinance")}</p> : balances.map((b) => (
                <dl key={b.currency} className="space-y-1 text-sm">
                  {(["invoiced", "credited", "paid", "refunded"] as const).map((k) => <div key={k} className="flex justify-between"><dt>{t(`repKey.${k}`)}</dt><dd><Money value={b[k].toString()} currency={b.currency} locale={locale} /></dd></div>)}
                  <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>{b.balance.isNegative() ? t("crm.inCredit") : t("crm.owes")}</dt><dd><Money value={b.balance.abs().toString()} currency={b.currency} locale={locale} /></dd></div>
                </dl>
              ))}
              <form action={`/customers/${id}#balance`} className="grid gap-2 text-sm sm:grid-cols-2">
                <label>{t("rep.from")}<input className="input mt-1 block w-full" type="date" name="from" defaultValue={sp.from ?? `${today.slice(0, 4)}-01-01`} required /></label>
                <label>{t("rep.to")}<input className="input mt-1 block w-full" type="date" name="to" defaultValue={sp.to ?? today} required /></label>
                {balances.length > 1 && <select name="currency" className="input" defaultValue={sp.currency} aria-label={t("suppliers.currency")}>{balances.map((b) => <option key={b.currency}>{b.currency}</option>)}</select>}
                <button className="btn-secondary">{t("crm.statement")}</button>
              </form>
              {statement && (
                <TableScroll label={t("crm.statement")}>
                  <table className="table text-xs">
                    <thead><tr><th scope="col">{t("item.date")}</th><th scope="col">{t("crm.document")}</th><th scope="col">{t("crm.debit")}</th><th scope="col">{t("crm.credit")}</th><th scope="col">{t("booking.balance")}</th></tr></thead>
                    <tbody>
                      <tr><td colSpan={4}>{t("crm.opening")}</td><td dir="ltr">{statement.opening}</td></tr>
                      {statement.lines.map((l, n) => <tr key={n}><td dir="ltr">{l.date}</td><td dir="ltr">{l.number}</td><td dir="ltr">{l.debit}</td><td dir="ltr">{l.credit}</td><td dir="ltr">{l.balance}</td></tr>)}
                      <tr className="font-semibold"><td colSpan={4}>{t("crm.closing")} ({statement.currency})</td><td dir="ltr">{statement.closing}</td></tr>
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </section>
          )}
          <section className="card" aria-labelledby="contacts">
            <h2 id="contacts" className="mb-3 font-semibold">{t("crm.contacts")}</h2>
            <ul className="space-y-2 text-sm">
              {c.contacts.map((ct) => (
                <li key={ct.id} className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{ct.name} {ct.isPrimary && <span className="badge">{t("crm.primary")}</span>}</div>
                    <div className="text-muted" dir="ltr">{[ct.title, ct.phone, ct.email].filter(Boolean).join(" · ")}</div>
                  </div>
                  {w && <ActionButton url={`/api/v1/customers/${c.id}/contacts/${ct.id}`} method="DELETE" label={t("common.delete")} locale={locale} variant="danger" confirm={t("common.deleteConfirm")} />}
                </li>
              ))}
            </ul>
            {w && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm underline">{t("crm.addContact")}</summary>
                <ApiForm action={`/api/v1/customers/${c.id}/contacts`} schema="contact" locale={locale} submitLabel={t("common.add")} resetOnSuccess className="mt-3 space-y-3">
                  <Field name="name" label={t("field.name")} required />
                  <Field name="title" label={t("field.jobTitle")} />
                  <Field name="phone" type="tel" label={t("field.phone")} dir="ltr" />
                  <Field name="email" type="email" label={t("field.email")} dir="ltr" />
                  <Checkbox name="isPrimary" label={t("crm.primary")} />
                  <Checkbox name="receivesInvoices" label={t("crm.receivesInvoices")} />
                </ApiForm>
              </details>
            )}
          </section>

          {w && (
            <section className="card" aria-labelledby="log">
              <h2 id="log" className="mb-3 font-semibold">{t("crm.logInteraction")}</h2>
              <ApiForm action={`/api/v1/customers/${c.id}/interactions`} schema="interaction" locale={locale} submitLabel={t("crm.log")} resetOnSuccess className="space-y-3">
                <Field name="channel" label={t("crm.channel")} options={opts(["CALL", "WHATSAPP", "EMAIL", "SMS", "MEETING", "NOTE", "OTHER"], "channel")} />
                <Field name="direction" label={t("crm.direction")} options={[{ value: "IN", label: t("direction.IN") }, { value: "OUT", label: t("direction.OUT") }]} />
                <Field name="occurredAt" type="datetime-local" label={t("crm.occurredAt")} required />
                <Field name="subject" label={t("crm.subject")} />
                <Field name="body" label={t("crm.body")} multiline required maxLength={10000} />
              </ApiForm>
            </section>
          )}

          <section className="card" aria-labelledby="timeline">
            <h2 id="timeline" className="mb-3 font-semibold">{t("crm.timeline")}</h2>
            {timeline.length === 0 ? (
              <EmptyState title={t("dashboard.noActivity")} />
            ) : (
              <ol className="space-y-3 text-sm">
                {timeline.map((e) => (
                  <li key={`${e.kind}-${e.id}`} className="border-s-2 border-line ps-3">
                    <div className="text-xs text-muted">{formatDateTime(e.at, locale, ctx.tenant.timezone)}{"by" in e && e.by ? ` · ${e.by}` : ""}</div>
                    {e.kind === "booking" ? (
                      <Link href={`/bookings/${e.id}`} className="underline" dir="ltr">{e.title}</Link>
                    ) : e.kind === "interaction" ? (
                      <div>
                        <span className="badge">{t(`channel.${e.channel}`)}</span> <span className="font-medium">{e.title}</span>
                        <p className="mt-1 whitespace-pre-line">{e.body}</p>
                      </div>
                    ) : (
                      <code className="text-xs" dir="ltr">{e.title}</code>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
