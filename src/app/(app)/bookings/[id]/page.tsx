import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiForm, Checkbox, Field } from "@/components/api-form";
import { ActionButton } from "@/components/actions";
import { ItemFields, ItineraryLinkButton, PassengerCheckboxes, RevealButton } from "@/components/travel";
import { EmptyState, Money, PageHeader, StatusBadge } from "@/components/ui";
import { AppError } from "@/server/errors";
import { pageCtx, pageT } from "@/server/page";
import { getBooking, getItinerary } from "@/modules/bookings/service";
import { ITEM_TRANSITIONS } from "@/modules/bookings/rules";
import { formatDate, formatDateTime } from "@/lib/format";
import { DocumentLinks } from "@/components/documents";
import { invoiceTone, MANUAL_METHODS } from "@/components/finance";
import { can } from "@/server/context";
import { latestDocuments } from "@/modules/documents/service";
import type { BookingItemStatus } from "@/generated/prisma/enums";

export const metadata = { title: "Booking" };

type Segment = { carrier: string; flightNumber: string; origin: string; destination: string; departureLocal: string; arrivalLocal: string; cabin: string };

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  const b = await getBooking(ctx, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const finance = can(ctx, "invoice:read");
  const [itinerary, suppliers, taxRates, travelers, invoices, accounts, docs] = await Promise.all([
    getItinerary(ctx, id),
    b.permissions.write ? ctx.db.supplier.findMany({ where: { archivedAt: null }, orderBy: { nameEn: "asc" }, take: 300 }) : Promise.resolve([]),
    b.permissions.write ? ctx.db.taxRate.findMany({ where: { active: true }, orderBy: { code: "asc" } }) : Promise.resolve([]),
    b.permissions.direct ? ctx.db.traveler.findMany({ where: { customerId: b.customerId, archivedAt: null }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    finance ? ctx.db.invoice.findMany({ where: { bookingId: id }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, status: true, number: true, total: true, amountPaid: true, amountCredited: true } }) : Promise.resolve([]),
    can(ctx, "payment:record") ? ctx.db.financialAccount.findMany({ where: { active: true, currency: b.currency }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    Promise.all([latestDocuments(ctx, "Booking", [id]), latestDocuments(ctx, "BookingItem", b.items.map((i) => i.id))]).then(([x, y]) => [...x, ...y]),
  ]);
  const uninvoiced = b.items.some((i) => i.status !== "CANCELLED" && i.status !== "FAILED" && i.invoicedQuantity < i.quantity);
  const p = b.permissions;
  const money = (v: { toString(): string } | string | null | undefined) => <Money value={v == null ? null : v.toString()} currency={b.currency} locale={locale} />;
  const paxName = (x: { title: string | null; firstName: string; lastName: string }) => [x.title, x.firstName, x.lastName].filter(Boolean).join(" ");
  const paxOptions = b.passengers.map((x) => ({ value: x.id, label: `${paxName(x)} (${x.paxType})` }));
  const vat = taxRates.find((r) => r.category === "STANDARD");
  const supplierOptions = suppliers.map((s) => ({ value: s.id, label: (locale === "ar" && s.nameAr) || s.nameEn }));
  const taxOptions = taxRates.map((r) => ({ value: r.id, label: locale === "ar" ? r.nameAr : r.nameEn }));
  const nextStatuses = (s: BookingItemStatus) => ITEM_TRANSITIONS[s].filter((x) => x !== "CANCELLED");

  return (
    <>
      <PageHeader
        title={b.reference}
        description={`${b.customer.displayName} · ${(locale === "ar" && b.branch.nameAr) || b.branch.nameEn} · ${b.owner.user.name}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={b.status} label={t(`bookingStatus.${b.status}`)} />
            {p.direct && <ActionButton url={`/api/v1/bookings/${b.id}/confirm`} body={{ version: b.version }} label={t("booking.confirm")} locale={locale} confirm={t("booking.confirmConfirm")} />}
            <ItineraryLinkButton url={`/api/v1/bookings/${b.id}/itinerary-link`} locale={locale} />
          </div>
        }
      />
      <p role="note" className="mb-4 text-xs text-muted">{t("booking.manualNote")}</p>
      {b.requiresApproval && !b.approvedAt && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          <span>{t("booking.approvalNeeded")}</span>
          {can(ctx, "quotation:approve-discount") && p.direct && <ActionButton url={`/api/v1/bookings/${b.id}/approve`} label={t("quote.approve")} locale={locale} />}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 xl:col-span-2">
          {/* ───────── Services ───────── */}
          <section className="card" aria-labelledby="services">
            <h2 id="services" className="mb-4 font-semibold">{t("booking.services")}</h2>
            {b.items.length === 0 && <EmptyState title={t("booking.noServices")} body={p.direct ? t("booking.noServicesHint") : undefined} />}
            <ul className="space-y-4">
              {b.items.map((i) => {
                const details = i.details as Record<string, unknown>;
                const active = i.status !== "CANCELLED" && i.status !== "FAILED";
                const assigned = b.passengers.filter((x) => i.passengerIds.includes(x.id));
                return (
                  <li key={i.id} className={`rounded-md border p-3 ${active ? "border-line" : "border-dashed border-line opacity-80"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <span className="badge me-2">{t(`service.${i.serviceType}`)}</span>
                        <span className="font-semibold">{i.description}</span>
                        <div className="text-sm text-muted">
                          {formatDate(i.startDate!, locale)}{i.endDate !== i.startDate ? ` – ${formatDate(i.endDate!, locale)}` : ""}
                          {i.supplier ? ` · ${(locale === "ar" && i.supplier.nameAr) || i.supplier.nameEn}` : ""}
                          {i.supplierConfirmation ? ` · ${t("item.confirmationShort")} ` : ""}
                          {i.supplierConfirmation && <bdi dir="ltr">{i.supplierConfirmation}</bdi>}
                          {i.pnr ? " · PNR " : ""}
                          {i.pnr && <bdi dir="ltr">{i.pnr}</bdi>}
                        </div>
                        {i.serviceType === "FLIGHT" && (
                          <ul className="mt-1 text-xs text-muted" dir="ltr">
                            {(details.segments as Segment[]).map((s, n) => (
                              <li key={n}>{s.carrier}{s.flightNumber} {s.origin} {s.departureLocal.replace("T", " ")} → {s.destination} {s.arrivalLocal.replace("T", " ")} · {s.cabin}</li>
                            ))}
                          </ul>
                        )}
                        {i.optionDeadline && i.status === "HELD" && <div className="mt-1 text-sm text-amber-800 dark:text-amber-300">{t("item.optionDeadline")}: {formatDateTime(i.optionDeadline, locale, ctx.tenant.timezone)}</div>}
                        {i.cancellation && <div className="mt-1 text-sm text-red-800 dark:text-red-300">{t("item.cancelled")}: {i.cancellation.reason} · {t("item.supplierFee")} {money(i.cancellation.supplierFee)} · {t("item.agencyFee")} {money(i.cancellation.agencyFee)}</div>}
                      </div>
                      <div className="text-end">
                        <StatusBadge status={i.status} label={t(`itemStatus.${i.status}`)} />
                        <div className="mt-1 text-sm">{money(i.sellAmount)}{Number(i.taxAmount) > 0 && <span className="text-muted"> + {t("item.tax")} {money(i.taxAmount)}</span>}</div>
                        {p.margin && <div className="text-xs text-muted">{t("item.cost")} {money(i.costAmount)} · {t("item.commission")} {money(i.commissionAmount)}</div>}
                      </div>
                    </div>
                    {assigned.length > 0 && (
                      <div className="mt-2 text-sm">
                        {assigned.map((x) => {
                          const ticket = i.tickets.find((tk) => tk.passengerId === x.id)?.ticketNumber;
                          return <span key={x.id} className="me-3">{paxName(x)}{ticket && <> · <bdi dir="ltr" className="font-mono">{ticket}</bdi></>}</span>;
                        })}
                      </div>
                    )}

                    {p.write && active && (
                      <div className="mt-3 flex flex-wrap gap-4 border-t border-line pt-3">
                        {nextStatuses(i.status).length > 0 && (
                          <details>
                            <summary className="cursor-pointer text-sm underline">{t("item.updateStatus")}</summary>
                            <ApiForm action={`/api/v1/bookings/${b.id}/items/${i.id}/status`} schema="itemStatus" locale={locale} submitLabel={t("common.save")} className="mt-3 grid gap-3 sm:grid-cols-2">
                              <Field name="status" label={t("field.status")} options={nextStatuses(i.status).map((s) => ({ value: s, label: t(`itemStatus.${s}`) }))} />
                              <Field name="supplierConfirmation" label={t("item.supplierConfirmation")} defaultValue={i.supplierConfirmation} dir="ltr" />
                              {i.serviceType === "FLIGHT" && <Field name="pnr" label={t("item.pnr")} defaultValue={i.pnr} dir="ltr" maxLength={8} />}
                              <Field name="optionDeadline" type="datetime-local" label={t("item.optionDeadline")} hint={t("item.optionDeadlineHint")} />
                              {i.serviceType === "FLIGHT" &&
                                assigned.map((x, n) => (
                                  <div key={x.id}>
                                    <input type="hidden" name={`tickets.${n}.passengerId`} value={x.id} />
                                    <Field name={`tickets.${n}.ticketNumber`} label={`${t("item.ticketFor")} ${paxName(x)}`} defaultValue={i.tickets.find((tk) => tk.passengerId === x.id)?.ticketNumber} dir="ltr" maxLength={13} />
                                  </div>
                                ))}
                              <div className="sm:col-span-2"><Field name="reason" label={t("item.note")} /></div>
                            </ApiForm>
                          </details>
                        )}
                        {paxOptions.length > 0 && i.status !== "ISSUED" && (
                          <details>
                            <summary className="cursor-pointer text-sm underline">{t("item.travellers")}</summary>
                            <ApiForm action={`/api/v1/bookings/${b.id}/items/${i.id}/passengers`} locale={locale} submitLabel={t("common.save")} className="mt-3 space-y-3">
                              <PassengerCheckboxes passengers={paxOptions} selected={i.passengerIds} label={t("item.whoTravels")} />
                            </ApiForm>
                          </details>
                        )}
                        {p.direct && (
                          <details>
                            <summary className="cursor-pointer text-sm underline">{t("common.edit")}</summary>
                            <ApiForm action={`/api/v1/bookings/${b.id}/items/${i.id}`} method="PATCH" schema="itemChanges" locale={locale} submitLabel={t("common.save")} className="mt-3 grid gap-3 sm:grid-cols-3">
                              <div className="sm:col-span-3"><Field name="description" label={t("item.description")} defaultValue={i.description} /></div>
                              <Field name="sellAmount" label={t("item.sell")} defaultValue={i.sellAmount.toString()} dir="ltr" />
                              {p.margin && <Field name="costAmount" label={t("item.cost")} defaultValue={i.costAmount?.toString()} dir="ltr" />}
                              <Field name="serviceFeeAmount" label={t("item.serviceFee")} defaultValue={i.serviceFeeAmount.toString()} dir="ltr" />
                              <Field name="discountAmount" label={t("item.discount")} defaultValue={i.discountAmount.toString()} dir="ltr" />
                              {p.margin && <Field name="commissionAmount" label={t("item.commission")} defaultValue={i.commissionAmount?.toString()} dir="ltr" />}
                            </ApiForm>
                          </details>
                        )}
                        {p.amend && (
                          <details>
                            <summary className="cursor-pointer text-sm underline">{t("amend.change")}</summary>
                            <ApiForm action={`/api/v1/bookings/${b.id}/amendments`} schema="amendment" locale={locale} submitLabel={t("amend.create")} className="mt-3 grid gap-3 sm:grid-cols-3">
                              <p className="text-xs text-muted sm:col-span-3">{t("amend.hint")}</p>
                              <input type="hidden" name="operations.0.op" value="updateItem" />
                              <input type="hidden" name="operations.0.itemId" value={i.id} />
                              <Field name="operations.0.changes.sellAmount" label={t("item.sell")} placeholder={i.sellAmount.toString()} dir="ltr" />
                              {p.margin && <Field name="operations.0.changes.costAmount" label={t("item.cost")} placeholder={i.costAmount?.toString()} dir="ltr" />}
                              <Field name="operations.0.changes.supplierConfirmation" label={t("item.supplierConfirmation")} placeholder={i.supplierConfirmation ?? ""} dir="ltr" />
                              <Field name="supplierFee" label={t("item.supplierFee")} defaultValue="0" dir="ltr" />
                              <Field name="agencyFee" label={t("item.agencyFee")} defaultValue="0" dir="ltr" />
                              <div className="sm:col-span-3"><Field name="reason" label={t("amend.reason")} required /></div>
                            </ApiForm>
                          </details>
                        )}
                        <details>
                          <summary className="cursor-pointer text-sm text-red-700 underline dark:text-red-300">{t("item.cancel")}</summary>
                          <ApiForm action={`/api/v1/bookings/${b.id}/items/${i.id}/cancel`} schema="cancelItem" locale={locale} submitLabel={t("item.confirmCancel")} className="mt-3 grid gap-3 sm:grid-cols-3">
                            <p className="text-xs text-muted sm:col-span-3">{t("item.cancelHint")}</p>
                            <div className="sm:col-span-3"><Field name="reason" label={t("item.cancelReason")} required /></div>
                            <Field name="supplierFee" label={t("item.supplierFee")} defaultValue="0" dir="ltr" />
                            <Field name="agencyFee" label={t("item.agencyFee")} defaultValue="0" dir="ltr" />
                            <Field name="expectedSupplierRefund" label={t("item.expectedRefund")} defaultValue="0" dir="ltr" />
                          </ApiForm>
                        </details>
                        {p.direct && !b.confirmedAt && (i.status === "REQUESTED" || i.status === "FAILED") && (
                          <ActionButton url={`/api/v1/bookings/${b.id}/items/${i.id}`} method="DELETE" label={t("common.delete")} locale={locale} variant="danger" confirm={t("common.deleteConfirm")} />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {p.direct && (
              <details className="mt-4" open={b.items.length === 0}>
                <summary className="cursor-pointer font-medium underline">{t("booking.addService")}</summary>
                <ApiForm action={`/api/v1/bookings/${b.id}/items`} schema="bookingItem" locale={locale} submitLabel={t("booking.addService")} className="mt-3 space-y-4">
                  <ItemFields locale={locale} suppliers={supplierOptions} taxRates={taxOptions} defaultTaxRateId={vat?.id} />
                </ApiForm>
              </details>
            )}
          </section>

          {/* ───────── Passengers ───────── */}
          <section className="card" aria-labelledby="passengers">
            <h2 id="passengers" className="mb-4 font-semibold">{t("booking.passengers")}</h2>
            {b.passengers.length === 0 && <EmptyState title={t("booking.noPassengers")} />}
            <ul className="divide-y divide-line text-sm">
              {b.passengers.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <span className="font-medium" dir="ltr">{paxName(x)}</span> <span className="badge">{t(`paxType.${x.paxType}`)}</span>
                    {x.isLead ? <span className="badge ms-1">{t("booking.lead")}</span> : null}
                    <div className="text-xs text-muted">
                      {x.dateOfBirth ? formatDate(x.dateOfBirth, locale) : ""}
                      {x.docNumber && <> · {t(`doc.${x.docType}`)} <bdi dir="ltr" className="font-mono">{x.docNumber}</bdi></>}
                      {x.docExpiry ? ` · ${t("crm.expires", { date: formatDate(x.docExpiry, locale) })}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {x.docNumber && p.revealDocs && <RevealButton url={`/api/v1/bookings/${b.id}/passengers/${x.id}/reveal`} locale={locale} />}
                    {p.direct && x.travelerId && <ActionButton url={`/api/v1/bookings/${b.id}/passengers/${x.id}/refresh`} label={t("booking.refreshFromProfile")} locale={locale} />}
                    {p.direct && <ActionButton url={`/api/v1/bookings/${b.id}/passengers/${x.id}`} method="DELETE" label={t("common.remove")} locale={locale} variant="danger" confirm={t("common.deleteConfirm")} />}
                  </div>
                </li>
              ))}
            </ul>
            {p.direct && (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {travelers.length > 0 && (
                  <ApiForm action={`/api/v1/bookings/${b.id}/passengers`} schema="passenger" locale={locale} submitLabel={t("booking.addFromProfile")} className="space-y-3">
                    <Field name="travelerId" label={t("booking.traveler")} options={travelers.map((tr) => ({ value: tr.id, label: `${tr.firstName} ${tr.lastName}` }))} />
                    <Checkbox name="isLead" label={t("booking.lead")} />
                  </ApiForm>
                )}
                <details>
                  <summary className="cursor-pointer text-sm underline">{t("booking.addManually")}</summary>
                  <ApiForm action={`/api/v1/bookings/${b.id}/passengers`} schema="passenger" locale={locale} submitLabel={t("common.add")} resetOnSuccess className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field name="firstName" label={t("crm.firstNameLatin")} dir="ltr" required />
                    <Field name="lastName" label={t("crm.lastNameLatin")} dir="ltr" required />
                    <Field name="title" label={t("crm.title2")} options={[{ value: "", label: "—" }, ...["MR", "MRS", "MS", "MSTR", "MISS"].map((v) => ({ value: v, label: v }))]} />
                    <Field name="dateOfBirth" type="date" label={t("crm.dateOfBirth")} />
                    <Field name="docType" label={t("crm.docType")} options={[{ value: "", label: "—" }, ...["PASSPORT", "NATIONAL_ID", "IQAMA"].map((v) => ({ value: v, label: t(`doc.${v}`) }))]} />
                    <Field name="docNumber" label={t("crm.docNumber")} dir="ltr" autoComplete="off" />
                    <Field name="docExpiry" type="date" label={t("crm.expiryDate")} />
                    <Field name="infantOfPassengerId" label={t("booking.infantOf")} options={[{ value: "", label: "—" }, ...paxOptions]} />
                  </ApiForm>
                </details>
              </div>
            )}
          </section>

          {/* ───────── Itinerary ───────── */}
          <section className="card" aria-labelledby="itinerary">
            <h2 id="itinerary" className="mb-4 font-semibold">{t("booking.itinerary")}</h2>
            {itinerary.entries.length === 0 ? (
              <EmptyState title={t("booking.noItinerary")} />
            ) : (
              <ol className="space-y-2 text-sm">
                {itinerary.entries.map((e, n) => (
                  <li key={n} className="flex gap-3">
                    <span className="w-28 shrink-0 text-muted">{formatDate(e.date, locale)}{e.time && <> <bdi dir="ltr">{e.time}</bdi></>}</span>
                    <span>
                      <span className="badge me-1">{t(`itinerary.${e.kind}`)}</span> {e.title}
                      {e.detail && <span className="text-muted"> · <bdi dir="ltr">{e.detail}</bdi></span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {b.itineraryNotes.length > 0 && p.write && (
              <ul className="mt-3 space-y-1 text-xs">
                {b.itineraryNotes.map((n) => (
                  <li key={n.id} className="flex items-center gap-2">
                    {formatDate(n.date!, locale)} · {(locale === "ar" && n.textAr) || n.textEn}
                    <ActionButton url={`/api/v1/bookings/${b.id}/notes/${n.id}`} method="DELETE" label={t("common.delete")} locale={locale} variant="danger" />
                  </li>
                ))}
              </ul>
            )}
            {p.write && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm underline">{t("booking.addNote")}</summary>
                <ApiForm action={`/api/v1/bookings/${b.id}/notes`} schema="itineraryNote" locale={locale} submitLabel={t("common.add")} resetOnSuccess className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field name="date" type="date" label={t("item.date")} required defaultValue={b.travelStartDate} />
                  <Field name="textEn" label={t("booking.noteEn")} dir="ltr" />
                  <Field name="textAr" label={t("booking.noteAr")} dir="rtl" />
                </ApiForm>
              </details>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="card" aria-labelledby="totals">
            <h2 id="totals" className="mb-3 font-semibold">{t("booking.totals")}</h2>
            <dl className="space-y-1 text-sm">
              {(
                [
                  ["booking.subtotal", b.sellTotal],
                  ["booking.tax", b.taxTotal],
                  ["booking.total", b.grandTotal],
                  ["booking.paid", b.paidTotal],
                  ["booking.balance", b.balance],
                  ...(p.margin ? [["booking.costTotal", b.costTotal], ["booking.commission", b.commissionTotal]] : []),
                ] as [string, { toString(): string } | null][]
              ).map(([k, v]) => (
                <div key={k} className={`flex justify-between ${k === "booking.total" ? "border-t border-line pt-1 font-semibold" : ""}`}>
                  <dt>{t(k)}</dt>
                  <dd>{money(v)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-muted">{b.pricesIncludeTax ? t("booking.pricesInclusive") : t("booking.pricesExclusive")}{b.currency !== "SAR" ? ` · 1 ${b.currency} = ${b.exchangeRate.toString()}` : ""}</p>
          </section>

          {finance && (
            <section className="card space-y-3" aria-labelledby="billing">
              <h2 id="billing" className="font-semibold">{t("booking.billing")}</h2>
              {invoices.length === 0 ? <p className="text-sm text-muted">{t("booking.noInvoices")}</p> : (
                <ul className="space-y-1 text-sm">
                  {invoices.map((i) => {
                    const outstanding = i.kind === "INVOICE" ? i.total.minus(i.amountCredited).minus(i.amountPaid) : null;
                    return (
                      <li key={i.id} className="flex items-center justify-between gap-2">
                        <Link className="underline" href={`/invoices/${i.id}`} dir="ltr">{i.number ?? t("invStatus.DRAFT")}</Link>
                        <span className="flex items-center gap-2">{money(i.total)}<StatusBadge status={invoiceTone({ ...i, outstanding })} label={i.status === "DRAFT" ? t("invStatus.DRAFT") : i.kind === "CREDIT_NOTE" ? t("invKind.CREDIT_NOTE") : Number(outstanding) <= 0 ? t("inv.paid") : t("inv.unpaid")} /></span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {can(ctx, "invoice:issue") && uninvoiced && <ActionButton url="/api/v1/invoices" body={{ bookingId: b.id }} label={t("booking.createInvoice")} locale={locale} />}
              {accounts.length > 0 && b.status !== "CANCELLED" && (
                <details className="text-sm">
                  <summary className="cursor-pointer underline">{t("booking.recordDeposit")}</summary>
                  <p className="mt-2 text-xs text-muted">{t("booking.depositHint")}</p>
                  <ApiForm action="/api/v1/payments" schema="payment" locale={locale} submitLabel={t("pay.record")} extra={{ customerId: b.customerId, bookingId: b.id, currency: b.currency }} resetOnSuccess className="mt-2 space-y-2">
                    <Field name="amount" label={t("pay.amount")} dir="ltr" required />
                    <Field name="date" type="date" label={t("item.date")} defaultValue={new Date().toISOString().slice(0, 10)} required />
                    <Field name="method" label={t("pay.method")} options={MANUAL_METHODS.map((m) => ({ value: m, label: t(`method.${m}`) }))} />
                    <Field name="financialAccountId" label={t("pay.account")} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
                    <Field name="reference" label={t("pay.reference")} dir="ltr" />
                  </ApiForm>
                </details>
              )}
            </section>
          )}

          <section className="card" aria-labelledby="bdocs">
            <h2 id="bdocs" className="mb-3 font-semibold">{t("docs.title")}</h2>
            <DocumentLinks docs={docs} requestUrl={`/api/v1/bookings/${b.id}/documents`} requestBody={{ kind: "CONFIRMATION" }} label={t("docs.confirmation")} locale={locale} t={t} />
            {b.items.filter((i) => i.status === "CONFIRMED" || i.status === "ISSUED").map((i) => (
              <div key={i.id} className="mt-2"><ActionButton url={`/api/v1/bookings/${b.id}/documents`} body={{ kind: "VOUCHER", itemId: i.id }} label={`${t("docs.voucher")}: ${i.description}`} locale={locale} /></div>
            ))}
          </section>

          <section className="card" aria-labelledby="customer">
            <h2 id="customer" className="mb-2 font-semibold">{t("booking.customer")}</h2>
            <Link href={`/customers/${b.customer.id}`} className="underline">{b.customer.displayName}</Link>
            <div className="text-sm text-muted" dir="ltr">{[b.customer.phone, b.customer.email].filter(Boolean).join(" · ")}</div>
          </section>

          {p.write && (
            <section className="card" aria-labelledby="notes">
              <h2 id="notes" className="mb-3 font-semibold">{t("booking.notes")}</h2>
              <ApiForm action={`/api/v1/bookings/${b.id}`} method="PATCH" schema="bookingUpdate" locale={locale} submitLabel={t("common.save")} extra={{ version: b.version }} className="space-y-3">
                <Field name="notes" label={t("booking.internalNotes")} defaultValue={b.notes} multiline />
                <Field name="customerNotes" label={t("booking.customerNotes")} defaultValue={b.customerNotes} multiline hint={t("booking.customerNotesHint")} />
              </ApiForm>
            </section>
          )}

          {b.amendments.length > 0 && (
            <section className="card" aria-labelledby="amendments">
              <h2 id="amendments" className="mb-3 font-semibold">{t("amend.title")}</h2>
              <ul className="space-y-3 text-sm">
                {b.amendments.map((a) => (
                  <li key={a.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">#{a.number} · {a.reason}</span>
                      <span className="badge">{t(`amendStatus.${a.status}`)}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {t("item.supplierFee")} {money(a.supplierFee)} · {t("item.agencyFee")} {money(a.agencyFee)}
                      {a.status === "APPLIED" && <> · {t("amend.difference")} {money(a.priceDifference)}</>}
                    </div>
                    {a.status === "DRAFT" && p.amend && (
                      <div className="mt-2 flex gap-2">
                        <ActionButton url={`/api/v1/bookings/${b.id}/amendments/${a.id}/apply`} label={t("amend.apply")} locale={locale} confirm={t("amend.applyConfirm")} />
                        <ActionButton url={`/api/v1/bookings/${b.id}/amendments/${a.id}/cancel`} label={t("common.cancel")} locale={locale} variant="danger" />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {p.write && (
            <section className="card border-red-200 dark:border-red-900" aria-labelledby="cancel">
              <h2 id="cancel" className="mb-2 font-semibold">{t("booking.cancelTitle")}</h2>
              <p className="mb-3 text-xs text-muted">{t("booking.cancelHint")}</p>
              <ApiForm action={`/api/v1/bookings/${b.id}/cancel`} schema="cancelBooking" locale={locale} submitLabel={t("booking.cancel")} extra={{ version: b.version }} className="space-y-3">
                <Field name="reason" label={t("item.cancelReason")} required />
              </ApiForm>
            </section>
          )}

          <section className="card" aria-labelledby="history">
            <h2 id="history" className="mb-3 font-semibold">{t("booking.history")}</h2>
            <ol className="space-y-2 text-xs">
              {b.history.map((h) => (
                <li key={h.id}>
                  <span className="text-muted">{formatDateTime(h.createdAt, locale, ctx.tenant.timezone)}</span> · {h.bookingItemId ? t("booking.serviceStatus") : t("booking.bookingStatus")}: {h.fromStatus ? `${h.fromStatus} → ` : ""}{h.toStatus}
                  {h.reason && <span className="text-muted"> · {h.reason}</span>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
