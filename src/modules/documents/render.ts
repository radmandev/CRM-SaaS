import { createHash, randomUUID } from "node:crypto";
import { tenantDb, type TenantTx } from "@/server/db";
import { getObject, putObject } from "@/server/storage";
import { htmlToPdf } from "@/server/pdf";
import { notFound } from "@/server/errors";
import { isLocale, type Locale } from "@/lib/i18n";
import { buildItinerary } from "@/modules/bookings/rules";
import { confirmationHtml, invoiceHtml, quotationHtml, receiptHtml, voucherHtml, type Agency } from "./templates";
import type { DocKind } from "./service";

// Worker side only: this module pulls in react-dom/server and Chromium, which Next refuses in app bundles.
// Pages and routes use ./service, which only queues "pdf.render" jobs.

// §14.4 generated documents. Issued financial PDFs are generated once and kept (immutability);
// quotation, confirmation and voucher PDFs are regenerated on request.

async function agencyOf(db: TenantTx, tenantId: string): Promise<Agency> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const logo = await db.document.findFirst({ where: { category: "LOGO" }, orderBy: { createdAt: "desc" } });
  const logoDataUrl = logo ? `data:${logo.mimeType};base64,${Buffer.from(await getObject(logo.storageKey)).toString("base64")}` : null;
  return {
    legalNameEn: t.legalNameEn, legalNameAr: t.legalNameAr, vatNumber: t.vatRegistered ? t.vatNumber : null, crNumber: t.crNumber, phone: t.phone, email: t.email,
    address: [t.addressBuilding, t.addressStreet, t.addressDistrict, t.addressCity, t.addressPostalCode].filter(Boolean).join(", "),
    primaryColor: t.primaryColor, documentFooterEn: t.documentFooterEn, documentFooterAr: t.documentFooterAr, logoDataUrl,
  };
}

const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const fmtTs = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "");

async function build(db: TenantTx, tenantId: string, kind: DocKind, id: string, itemId?: string, localeArg?: Locale) {
  const agency = await agencyOf(db, tenantId);
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultLocale: true } });
  if (kind === "INVOICE") {
    const inv = await db.invoice.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { sortOrder: "asc" } }, original: { select: { number: true } } } });
    const buyer = (inv.customerSnapshot ?? {}) as { name?: string; nameAr?: string | null; vatNumber?: string | null; address?: string | null; crNumber?: string | null };
    const html = await invoiceHtml(agency, {
      kind: inv.kind, type: inv.type, number: inv.number ?? "DRAFT", issuedAt: fmtTs(inv.issuedAt), supplyDate: date(inv.supplyDate) || null, dueDate: date(inv.dueDate) || null,
      currency: inv.currency, originalNumber: inv.original?.number ?? null, reason: inv.reason, qrPayload: inv.qrPayload, uuid: inv.zatcaUuid,
      buyer: { name: buyer.name ?? "", nameAr: buyer.nameAr ?? null, vatNumber: buyer.vatNumber ?? null, address: buyer.address ?? null, crNumber: buyer.crNumber ?? null },
      lines: inv.lines.map((l) => {
        const s = l.taxRateSnapshot as { rate: string; zatcaCode: string };
        return { description: l.descriptionEn, descriptionAr: l.descriptionAr, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discount: l.discount.toString(), net: l.netAmount.toString(), ratePercent: s.rate, zatcaCode: s.zatcaCode, tax: l.taxAmount.toString(), total: l.totalAmount.toString() };
      }),
      totals: { taxable: inv.taxableAmount.toString(), discount: inv.discountTotal.toString(), tax: inv.taxAmount.toString(), total: inv.total.toString(), paid: inv.kind === "INVOICE" ? inv.amountPaid.toString() : null },
    });
    return { html, filename: `${inv.number}.pdf`, entityType: "Invoice", entityId: id };
  }
  if (kind === "RECEIPT") {
    const p = await db.payment.findUniqueOrThrow({ where: { id }, include: { customer: true, booking: { select: { reference: true } }, allocations: { where: { releasedAt: null }, include: { invoice: { select: { number: true } } } } } });
    const html = receiptHtml(agency, {
      number: p.number, date: date(p.date), customer: p.customer.displayName, amount: p.amount.toString(), currency: p.currency, method: p.method, reference: p.reference,
      bookingRef: p.booking?.reference ?? null, allocations: p.allocations.map((a) => ({ invoice: a.invoice.number ?? "", amount: a.amount.toString() })),
    });
    return { html, filename: `${p.number}.pdf`, entityType: "Payment", entityId: id };
  }
  if (kind === "QUOTATION") {
    const q = await db.quotation.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { sortOrder: "asc" } }, customer: true } });
    const locale = localeArg ?? (isLocale(q.customer.preferredLocale) ? q.customer.preferredLocale : "ar");
    const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { quotationTermsEn: true, quotationTermsAr: true } });
    const html = quotationHtml(agency, {
      number: q.number ?? "DRAFT", versionNo: q.versionNo, date: date(q.sentAt ?? q.createdAt), validUntil: date(q.validUntil), customer: q.customer.displayName, currency: q.currency,
      showItemPrices: q.showItemPrices, customerNotes: q.customerNotes,
      terms: (locale === "ar" ? q.termsAr || t.quotationTermsAr : q.termsEn || t.quotationTermsEn) ?? null,
      items: q.items.map((i) => ({ type: i.serviceType, description: i.description, dates: date(i.startDate) === date(i.endDate) ? date(i.startDate) : `${date(i.startDate)} – ${date(i.endDate)}`, total: i.sellAmount.plus(i.serviceFeeAmount).minus(i.discountAmount).toString() })),
      totals: { sell: q.sellTotal.toString(), tax: q.taxTotal.toString(), grand: q.grandTotal.toString() },
    }, locale);
    return { html, filename: `${q.number ?? "quotation"}-v${q.versionNo}.pdf`, entityType: "Quotation", entityId: id };
  }
  const b = await db.booking.findUniqueOrThrow({
    where: { id },
    include: { customer: true, items: { orderBy: { sortOrder: "asc" }, include: { supplier: true, passengers: { include: { bookingPassenger: true } } } }, passengers: { orderBy: [{ isLead: "desc" }, { createdAt: "asc" }] }, itineraryNotes: true },
  });
  const locale = localeArg ?? (isLocale(b.customer.preferredLocale) ? b.customer.preferredLocale : isLocale(tenant.defaultLocale) ? tenant.defaultLocale : "ar");
  const paxName = (p: { title: string | null; firstName: string; lastName: string }) => [p.title, p.firstName, p.lastName].filter(Boolean).join(" ");
  if (kind === "CONFIRMATION") {
    const entries = buildItinerary(
      b.items.map((i) => ({ ...i, startDate: date(i.startDate), endDate: date(i.endDate), details: i.details as Record<string, unknown> })),
      b.itineraryNotes.map((n) => ({ date: date(n.date), text: (locale === "ar" ? n.textAr || n.textEn : n.textEn || n.textAr) ?? "" })),
    );
    const html = confirmationHtml(agency, {
      reference: b.reference, customer: b.customer.displayName, currency: b.currency, passengers: b.passengers.map(paxName), customerNotes: b.customerNotes, entries,
      confirmations: b.items.filter((i) => i.status !== "CANCELLED" && i.status !== "FAILED").map((i) => ({ description: i.description, confirmation: i.pnr ?? i.supplierConfirmation })),
      totals: { grand: b.grandTotal.toString(), paid: b.paidTotal.toString(), balance: b.balance.toString() },
    }, locale);
    return { html, filename: `${b.reference}-confirmation.pdf`, entityType: "Booking", entityId: id };
  }
  const item = b.items.find((i) => i.id === itemId);
  if (!item) throw notFound();
  const d = item.details as Record<string, unknown>;
  const details: [string, string][] =
    item.serviceType === "HOTEL" ? [["item.checkIn", String(d.checkIn)], ["item.checkOut", String(d.checkOut)], ["item.roomType", ((d.rooms as { roomType: string; board: string }[]) ?? []).map((r) => `${r.roomType} (${r.board})`).join(", ")]]
    : item.serviceType === "TRANSFER" ? [["item.pickup", String(d.pickupLocation)], ["item.dropoff", String(d.dropoffLocation)], ["item.pickupAt", String(d.pickupAt).replace("T", " ")]]
    : item.serviceType === "TOUR" ? [["item.meetingPoint", String(d.meetingPoint ?? "—")], ["item.startTime", String(d.startTime ?? "—")]]
    : [];
  const html = voucherHtml(agency, {
    reference: b.reference, type: item.serviceType, description: item.description, dates: `${date(item.startDate)}${item.endDate.getTime() !== item.startDate.getTime() ? ` – ${date(item.endDate)}` : ""}`,
    supplier: item.supplier ? (locale === "ar" && item.supplier.nameAr) || item.supplier.nameEn : null, supplierPhone: item.supplier?.phone ?? null, confirmation: item.supplierConfirmation,
    passengers: item.passengers.map((p) => paxName(p.bookingPassenger)), details,
  }, locale);
  return { html, filename: `${b.reference}-voucher-${item.sortOrder + 1}.pdf`, entityType: "BookingItem", entityId: item.id };
}

/** Render and store a PDF (worker side). For invoices the result is linked once and never replaced. */
export async function generateDocument(tenantId: string, kind: DocKind, id: string, itemId?: string, uploadedById?: string) {
  const db = tenantDb(tenantId);
  if (kind === "INVOICE") {
    const existing = await db.invoice.findUniqueOrThrow({ where: { id }, select: { pdfDocumentId: true, status: true, createdById: true } });
    if (existing.pdfDocumentId) return existing.pdfDocumentId;
    if (existing.status !== "ISSUED") throw new Error("Only issued invoices get a stored PDF");
    uploadedById ??= existing.createdById;
  }
  const d = await build(db, tenantId, kind, id, itemId);
  const bytes = await htmlToPdf(d.html);
  const docId = randomUUID();
  const storageKey = `tenants/${tenantId}/generated/${kind.toLowerCase()}/${docId}.pdf`; // TEN-09
  await putObject(storageKey, bytes, "application/pdf");
  return db.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: { id: docId, tenantId, storageKey, filename: d.filename, mimeType: "application/pdf", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), category: kind, entityType: d.entityType, entityId: d.entityId, uploadedById: uploadedById ?? tenantId, generated: true },
    });
    if (kind === "INVOICE") await tx.invoice.update({ where: { id }, data: { pdfDocumentId: doc.id } });
    return doc.id;
  });
}

