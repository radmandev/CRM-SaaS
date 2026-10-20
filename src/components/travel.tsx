"use client";

import { useMemo, useState } from "react";
import { Checkbox, Field } from "./api-form";
import { translator, type Locale } from "@/lib/i18n";

type Opt = { value: string; label: string };

/** Shows a sensitive value after an audited POST (CRM-07). Nothing is stored in the page until clicked. */
export function RevealButton({ url, locale, field = "number" }: { url: string; locale: Locale; field?: string }) {
  const t = useMemo(() => translator(locale), [locale]);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (value !== null) return <bdi dir="ltr" className="font-mono">{value || "—"}</bdi>;
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn-ghost text-xs underline"
        onClick={async () => {
          const res = await fetch(url, { method: "POST", headers: { "accept-language": locale } });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) return setError(data.title ?? t("error.FORBIDDEN"));
          setValue(data.data?.[field] ?? "");
        }}
      >
        {t("common.reveal")}
      </button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

/** Creates a signed customer link (BKG-13) and shows it for copying. */
export function ItineraryLinkButton({ url, locale }: { url: string; locale: Locale }) {
  const t = useMemo(() => translator(locale), [locale]);
  const [link, setLink] = useState<string | null>(null);
  return link ? (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <input readOnly value={link} className="input w-72" dir="ltr" aria-label={t("booking.itineraryLink")} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn-secondary" onClick={() => navigator.clipboard?.writeText(link)}>
        {t("common.copy")}
      </button>
    </span>
  ) : (
    <button
      type="button"
      className="btn-secondary"
      onClick={async () => {
        const res = await fetch(url, { method: "POST" });
        const data = await res.json();
        if (res.ok) setLink(data.data.url);
      }}
    >
      {t("booking.shareItinerary")}
    </button>
  );
}

const SERVICE_TYPES = ["FLIGHT", "HOTEL", "TRANSFER", "TOUR", "PACKAGE", "VISA", "INSURANCE", "OTHER"] as const;

/**
 * Service form fields (§7.1). Type-specific detail fields use dotted names (details.segments.0.origin) that
 * ApiForm turns into nested objects and arrays; the shared Zod schema validates them on both sides.
 */
export function ItemFields({ locale, suppliers, taxRates, defaultTaxRateId }: { locale: Locale; suppliers: Opt[]; taxRates: Opt[]; defaultTaxRateId?: string }) {
  const t = useMemo(() => translator(locale), [locale]);
  const [type, setType] = useState<(typeof SERVICE_TYPES)[number]>("FLIGHT");
  const [segments, setSegments] = useState([0]);
  const [rooms, setRooms] = useState([0]);
  const next = (rows: number[]) => [...rows, Math.max(-1, ...rows) + 1];
  const opt = (keys: string[], prefix: string) => keys.map((k) => ({ value: k, label: t(`${prefix}.${k}`) }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="serviceType" className="block text-sm font-medium">{t("item.serviceType")}</label>
          <select id="serviceType" name="serviceType" className="input" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {SERVICE_TYPES.map((s) => (
              <option key={s} value={s}>{t(`service.${s}`)}</option>
            ))}
          </select>
        </div>
        <Field name="supplierId" label={t("item.supplier")} options={[{ value: "", label: "—" }, ...suppliers]} />
        <Field name="description" label={t("item.description")} hint={t("item.descriptionHint")} maxLength={300} />
      </div>

      {type === "FLIGHT" && (
        <fieldset className="space-y-3 rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-semibold">{t("item.segments")}</legend>
          <Field name="details.tripType" label={t("item.tripType")} options={opt(["ONE_WAY", "RETURN", "MULTI_CITY"], "trip")} />
          {segments.map((i, n) => (
            <div key={i} className="grid gap-3 border-t border-line pt-3 sm:grid-cols-4">
              <Field name={`details.segments.${i}.carrier`} label={t("item.carrier")} dir="ltr" maxLength={2} placeholder="SV" required />
              <Field name={`details.segments.${i}.flightNumber`} label={t("item.flightNumber")} dir="ltr" maxLength={5} required />
              <Field name={`details.segments.${i}.origin`} label={t("item.origin")} dir="ltr" maxLength={3} placeholder="RUH" required />
              <Field name={`details.segments.${i}.destination`} label={t("item.destination")} dir="ltr" maxLength={3} required />
              <Field name={`details.segments.${i}.departureLocal`} type="datetime-local" label={t("item.departure")} required />
              <Field name={`details.segments.${i}.arrivalLocal`} type="datetime-local" label={t("item.arrival")} required />
              <Field name={`details.segments.${i}.cabin`} label={t("item.cabin")} options={opt(["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"], "cabin")} />
              <Field name={`details.segments.${i}.baggage`} label={t("item.baggage")} maxLength={40} />
              {segments.length > 1 && (
                <button type="button" className="btn-ghost text-sm underline sm:col-span-4" onClick={() => setSegments(segments.filter((x) => x !== i))}>
                  {t("item.removeSegment", { n: n + 1 })}
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn-secondary" onClick={() => setSegments(next(segments))}>{t("item.addSegment")}</button>
          <Field name="pnr" label={t("item.pnr")} dir="ltr" maxLength={8} />
        </fieldset>
      )}

      {type === "HOTEL" && (
        <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-semibold">{t("service.HOTEL")}</legend>
          <Field name="details.hotelName" label={t("item.hotelName")} required />
          <Field name="details.city" label={t("field.city")} required />
          <Field name="details.starRating" type="number" label={t("item.stars")} />
          <Field name="details.checkIn" type="date" label={t("item.checkIn")} required />
          <Field name="details.checkOut" type="date" label={t("item.checkOut")} required />
          <Field name="details.cancellationDeadline" type="date" label={t("item.cancellationDeadline")} />
          {rooms.map((i) => (
            <div key={i} className="grid gap-3 border-t border-line pt-3 sm:col-span-3 sm:grid-cols-3">
              <Field name={`details.rooms.${i}.roomType`} label={t("item.roomType")} required />
              <Field name={`details.rooms.${i}.board`} label={t("item.board")} options={opt(["RO", "BB", "HB", "FB", "AI"], "board")} defaultValue="BB" />
              <Field name={`details.rooms.${i}.adults`} type="number" label={t("item.adults")} defaultValue={2} />
              {rooms.length > 1 && (
                <button type="button" className="btn-ghost text-sm underline" onClick={() => setRooms(rooms.filter((x) => x !== i))}>{t("item.removeRoom")}</button>
              )}
            </div>
          ))}
          <button type="button" className="btn-secondary sm:col-span-3 sm:w-fit" onClick={() => setRooms(next(rooms))}>{t("item.addRoom")}</button>
          <div className="sm:col-span-3">
            <Field name="details.cancellationPolicy" label={t("item.cancellationPolicy")} multiline maxLength={2000} />
          </div>
        </fieldset>
      )}

      {type === "TRANSFER" && (
        <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-semibold">{t("service.TRANSFER")}</legend>
          <Field name="details.pickupLocation" label={t("item.pickup")} required />
          <Field name="details.dropoffLocation" label={t("item.dropoff")} required />
          <Field name="details.pickupAt" type="datetime-local" label={t("item.pickupAt")} required />
          <Field name="details.vehicleType" label={t("item.vehicle")} />
          <Field name="details.passengers" type="number" label={t("item.passengerCount")} defaultValue={1} />
          <Field name="details.flightReference" label={t("item.flightReference")} dir="ltr" />
        </fieldset>
      )}

      {type === "TOUR" && (
        <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-semibold">{t("service.TOUR")}</legend>
          <Field name="details.name" label={t("field.name")} required />
          <Field name="details.date" type="date" label={t("item.date")} required />
          <Field name="details.startTime" type="time" label={t("item.startTime")} />
          <Field name="details.meetingPoint" label={t("item.meetingPoint")} />
          <Field name="details.language" label={t("field.language")} />
        </fieldset>
      )}

      {type === "PACKAGE" && (
        <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">{t("service.PACKAGE")}</legend>
          <Field name="details.name" label={t("field.name")} required />
          <Field name="details.destinations" label={t("item.destinations")} />
          <div className="sm:col-span-2"><Field name="details.inclusions" label={t("item.inclusions")} multiline /></div>
        </fieldset>
      )}

      {type === "VISA" && (
        <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-semibold">{t("service.VISA")}</legend>
          <Field name="details.destinationCountry" label={t("item.destinationCountry")} dir="ltr" maxLength={2} required />
          <Field name="details.visaType" label={t("item.visaType")} options={opt(["TOURIST", "BUSINESS", "TRANSIT", "UMRAH", "OTHER"], "visa")} />
          <Field name="details.entries" label={t("item.entries")} options={opt(["SINGLE", "MULTIPLE"], "entries")} />
          <Field name="details.applicationStatus" label={t("item.applicationStatus")} options={opt(["NOT_STARTED", "DOCUMENTS_PENDING", "SUBMITTED", "APPROVED", "REJECTED"], "visaStatus")} />
          <Field name="details.applicationReference" label={t("item.applicationReference")} dir="ltr" />
        </fieldset>
      )}

      {type === "INSURANCE" && (
        <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-semibold">{t("service.INSURANCE")}</legend>
          <Field name="details.insurer" label={t("item.insurer")} />
          <Field name="details.policyNumber" label={t("item.policyNumber")} dir="ltr" />
          <Field name="details.coverage" label={t("item.coverage")} />
        </fieldset>
      )}

      {type === "OTHER" && <Field name="details.notes" label={t("item.notes")} multiline />}

      {!["FLIGHT", "HOTEL", "TOUR", "TRANSFER"].includes(type) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="startDate" type="date" label={t("item.startDate")} required />
          <Field name="endDate" type="date" label={t("item.endDate")} />
        </div>
      )}

      <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">{t("item.pricing")}</legend>
        <Field name="sellAmount" label={t("item.sell")} dir="ltr" defaultValue="0" required />
        <Field name="costAmount" label={t("item.cost")} dir="ltr" defaultValue="0" />
        <Field name="serviceFeeAmount" label={t("item.serviceFee")} dir="ltr" defaultValue="0" />
        <Field name="discountAmount" label={t("item.discount")} dir="ltr" defaultValue="0" />
        <Field name="commissionAmount" label={t("item.commission")} dir="ltr" defaultValue="0" hint={t("item.commissionHint")} />
        <Field name="taxRateId" label={t("item.taxRate")} options={[{ value: "", label: "—" }, ...taxRates]} defaultValue={defaultTaxRateId} />
        <Field name="taxBasis" label={t("item.taxBasis")} options={opt(["FULL_AMOUNT", "SERVICE_FEE_ONLY"], "taxBasis")} />
        <Field name="pricingModel" label={t("item.pricingModel")} options={opt(["NET", "COMMISSIONABLE"], "pricing")} />
        <Field name="quantity" type="number" label={t("item.quantity")} defaultValue={1} />
      </fieldset>
    </div>
  );
}

export function PassengerCheckboxes({ passengers, selected, label }: { passengers: Opt[]; selected: string[]; label: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {passengers.map((p) => (
          <Checkbox key={p.value} name="passengerIds" value={p.value} array label={p.label} defaultChecked={selected.includes(p.value)} />
        ))}
      </div>
    </fieldset>
  );
}
