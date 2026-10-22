import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import QRCode from "qrcode";
import { translator, type Locale } from "@/lib/i18n";

// PDF templates (§14.4). Bilingual where tax rules expect it (INV-05); the font is embedded so Arabic renders
// identically on every machine (assets/fonts, OFL).

let fontCss: string | undefined;
function fonts() {
  if (fontCss) return fontCss;
  const f = (w: string) => readFileSync(join(process.cwd(), "assets/fonts", `IBMPlexSansArabic-${w}.ttf`)).toString("base64");
  fontCss = `@font-face{font-family:Plex;src:url(data:font/ttf;base64,${f("Regular")});font-weight:400}@font-face{font-family:Plex;src:url(data:font/ttf;base64,${f("Bold")});font-weight:700}`;
  return fontCss;
}

const CSS = `
*{box-sizing:border-box}body{font-family:Plex,sans-serif;font-size:10.5px;color:#111;margin:0}
h1{font-size:18px;margin:0 0 2px}h2{font-size:12px;margin:14px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #d5d8dc;padding:4px 6px;vertical-align:top;text-align:start}
th{background:#f1f3f5;font-weight:700}.num{text-align:end;white-space:nowrap;direction:ltr;unicode-bidi:isolate}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.muted{color:#555}.ar{direction:rtl;text-align:right}.en{direction:ltr;text-align:left}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid var(--brand);padding-bottom:8px;margin-bottom:10px}
.totals td{border:none;padding:2px 6px}.totals tr.grand td{font-weight:700;border-top:1px solid #111}.box{border:1px solid #d5d8dc;padding:8px;border-radius:4px}
.ltr{direction:ltr;unicode-bidi:isolate}.footer{margin-top:16px;font-size:9px;color:#555;border-top:1px solid #ddd;padding-top:6px}
`;

export type Agency = {
  legalNameEn: string; legalNameAr: string | null; vatNumber: string | null; crNumber: string | null; phone: string | null; email: string | null;
  address: string; primaryColor: string; documentFooterEn: string | null; documentFooterAr: string | null; logoDataUrl: string | null;
};

function page(title: string, agency: Agency, body: React.ReactNode, dir: "ltr" | "rtl" = "ltr") {
  const html = renderToStaticMarkup(
    <html lang={dir === "rtl" ? "ar" : "en"} dir={dir}>
      <head>
        <meta charSet="utf-8" />
        <title>{title}</title>
        {/* Static CSS and embedded fonts only; the one tenant value (brand color) is regex-validated. */}
        {/* eslint-disable-next-line react/no-danger */}
        <style dangerouslySetInnerHTML={{ __html: fonts() + CSS + `:root{--brand:${/^#[0-9a-f]{6}$/i.test(agency.primaryColor) ? agency.primaryColor : "#0f766e"}}` }} />
      </head>
      <body>{body}</body>
    </html>,
  );
  return `<!doctype html>${html}`;
}

const money = (v: string | number, currency: string) => `${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

function AgencyHeader({ agency, titleEn, titleAr }: { agency: Agency; titleEn: string; titleAr: string }) {
  return (
    <div className="head">
      <div className="en">
        {agency.logoDataUrl && <img src={agency.logoDataUrl} alt="" style={{ height: 40, marginBottom: 4 }} />}
        <div><b>{agency.legalNameEn}</b></div>
        <div className="muted">{agency.address}</div>
        {agency.vatNumber && <div>VAT No: <span className="ltr">{agency.vatNumber}</span></div>}
        {agency.crNumber && <div>CR: <span className="ltr">{agency.crNumber}</span></div>}
      </div>
      <div style={{ textAlign: "center" }}>
        <h1>{titleEn}</h1>
        <h1 className="ar">{titleAr}</h1>
      </div>
      <div className="ar">
        <div><b>{agency.legalNameAr || agency.legalNameEn}</b></div>
        {agency.vatNumber && <div>الرقم الضريبي: <span className="ltr">{agency.vatNumber}</span></div>}
        {agency.crNumber && <div>السجل التجاري: <span className="ltr">{agency.crNumber}</span></div>}
      </div>
    </div>
  );
}

function Footer({ agency }: { agency: Agency }) {
  return (
    <div className="footer grid">
      <div className="en">{agency.documentFooterEn}{agency.phone && ` · ${agency.phone}`}{agency.email && ` · ${agency.email}`}</div>
      <div className="ar">{agency.documentFooterAr}</div>
    </div>
  );
}

// ───────── Tax invoice / credit note (INV-05, ZAT-02) ─────────

export type InvoiceDoc = {
  kind: "INVOICE" | "CREDIT_NOTE"; type: "STANDARD" | "SIMPLIFIED"; number: string; issuedAt: string; supplyDate: string | null; dueDate: string | null; currency: string;
  originalNumber: string | null; reason: string | null; qrPayload: string | null; uuid: string | null;
  buyer: { name: string; nameAr: string | null; vatNumber: string | null; address: string | null; crNumber: string | null };
  lines: { description: string; descriptionAr: string | null; quantity: string; unitPrice: string; discount: string; net: string; ratePercent: string; zatcaCode: string; tax: string; total: string }[];
  totals: { taxable: string; discount: string; tax: string; total: string; paid: string | null };
};

export async function invoiceHtml(agency: Agency, d: InvoiceDoc) {
  const qr = d.qrPayload ? await QRCode.toDataURL(d.qrPayload, { margin: 1, width: 150, errorCorrectionLevel: "M" }) : null;
  const [titleEn, titleAr] =
    d.kind === "CREDIT_NOTE"
      ? ["Credit Note", "إشعار دائن"]
      : d.type === "STANDARD" ? ["Tax Invoice", "فاتورة ضريبية"] : ["Simplified Tax Invoice", "فاتورة ضريبية مبسطة"];
  return page(`${titleEn} ${d.number}`, agency, (
    <>
      <AgencyHeader agency={agency} titleEn={titleEn} titleAr={titleAr} />
      <div className="grid">
        <table>
          <tbody>
            <tr><th>Invoice number · رقم الفاتورة</th><td className="num">{d.number}</td></tr>
            <tr><th>Issue date · تاريخ الإصدار</th><td className="num">{d.issuedAt}</td></tr>
            {d.supplyDate && <tr><th>Supply date · تاريخ التوريد</th><td className="num">{d.supplyDate}</td></tr>}
            {d.dueDate && d.kind === "INVOICE" && <tr><th>Due date · تاريخ الاستحقاق</th><td className="num">{d.dueDate}</td></tr>}
            {d.originalNumber && <tr><th>Original invoice · الفاتورة الأصلية</th><td className="num">{d.originalNumber}</td></tr>}
            {d.reason && <tr><th>Reason · السبب</th><td>{d.reason}</td></tr>}
          </tbody>
        </table>
        <div className="box">
          <b>Customer · العميل</b>
          <div>{d.buyer.name}{d.buyer.nameAr && <span className="ar"> · {d.buyer.nameAr}</span>}</div>
          {d.buyer.vatNumber && <div>VAT No · الرقم الضريبي: <span className="ltr">{d.buyer.vatNumber}</span></div>}
          {d.buyer.crNumber && <div>CR · السجل التجاري: <span className="ltr">{d.buyer.crNumber}</span></div>}
          {d.buyer.address && <div className="muted">{d.buyer.address}</div>}
        </div>
      </div>
      <h2>Details · التفاصيل</h2>
      <table>
        <thead>
          <tr>
            <th>Description · الوصف</th><th className="num">Qty · الكمية</th><th className="num">Unit price · سعر الوحدة</th><th className="num">Discount · الخصم</th>
            <th className="num">Taxable · الخاضع للضريبة</th><th className="num">VAT % · النسبة</th><th className="num">VAT · الضريبة</th><th className="num">Total · الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.description}{l.descriptionAr && <div className="ar">{l.descriptionAr}</div>}</td>
              <td className="num">{Number(l.quantity)}</td><td className="num">{money(l.unitPrice, d.currency)}</td><td className="num">{money(l.discount, d.currency)}</td>
              <td className="num">{money(l.net, d.currency)}</td><td className="num">{Number(l.ratePercent)}% ({l.zatcaCode})</td><td className="num">{money(l.tax, d.currency)}</td><td className="num">{money(l.total, d.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid" style={{ marginTop: 10 }}>
        <div>{qr && <img src={qr} alt="ZATCA QR" style={{ width: 120, height: 120 }} />}{d.uuid && <div className="muted ltr" style={{ fontSize: 8 }}>UUID {d.uuid}</div>}</div>
        <table className="totals">
          <tbody>
            <tr><td>Total excluding VAT · الإجمالي غير شامل الضريبة</td><td className="num">{money(d.totals.taxable, d.currency)}</td></tr>
            {Number(d.totals.discount) > 0 && <tr><td>Discount · الخصم</td><td className="num">{money(d.totals.discount, d.currency)}</td></tr>}
            <tr><td>Total VAT · إجمالي الضريبة</td><td className="num">{money(d.totals.tax, d.currency)}</td></tr>
            <tr className="grand"><td>Total including VAT · الإجمالي شامل الضريبة</td><td className="num">{money(d.totals.total, d.currency)}</td></tr>
            {d.totals.paid !== null && Number(d.totals.paid) > 0 && <tr><td>Paid · المدفوع</td><td className="num">{money(d.totals.paid, d.currency)}</td></tr>}
          </tbody>
        </table>
      </div>
      <Footer agency={agency} />
    </>
  ));
}

// ───────── Receipt (PAY-07) ─────────

export type ReceiptDoc = { number: string; date: string; customer: string; amount: string; currency: string; method: string; reference: string | null; allocations: { invoice: string; amount: string }[]; bookingRef: string | null };

export function receiptHtml(agency: Agency, d: ReceiptDoc) {
  const en = translator("en"), ar = translator("ar");
  return page(`Receipt ${d.number}`, agency, (
    <>
      <AgencyHeader agency={agency} titleEn="Payment Receipt" titleAr="سند قبض" />
      <table>
        <tbody>
          <tr><th>Receipt number · رقم السند</th><td className="num">{d.number}</td></tr>
          <tr><th>Date · التاريخ</th><td className="num">{d.date}</td></tr>
          <tr><th>Received from · استلمنا من</th><td>{d.customer}</td></tr>
          <tr><th>Amount · المبلغ</th><td className="num"><b>{money(d.amount, d.currency)}</b></td></tr>
          <tr><th>Method · طريقة الدفع</th><td>{en(`method.${d.method}`)} · {ar(`method.${d.method}`)}</td></tr>
          {d.reference && <tr><th>Reference · المرجع</th><td className="num">{d.reference}</td></tr>}
          {d.bookingRef && <tr><th>Booking · الحجز</th><td className="num">{d.bookingRef}</td></tr>}
        </tbody>
      </table>
      {d.allocations.length > 0 && (
        <>
          <h2>Applied to · مخصص لـ</h2>
          <table><tbody>{d.allocations.map((a, i) => <tr key={i}><td className="num">{a.invoice}</td><td className="num">{money(a.amount, d.currency)}</td></tr>)}</tbody></table>
        </>
      )}
      <Footer agency={agency} />
    </>
  ));
}

// ───────── Quotation (QT-04/05) ─────────

export type QuotationDoc = {
  number: string; versionNo: number; date: string; validUntil: string; customer: string; currency: string; showItemPrices: boolean; terms: string | null; customerNotes: string | null;
  items: { type: string; description: string; dates: string; total: string }[]; totals: { sell: string; tax: string; grand: string };
};

export function quotationHtml(agency: Agency, d: QuotationDoc, locale: Locale) {
  const t = translator(locale);
  return page(`${t("pdf.quotation")} ${d.number}`, agency, (
    <>
      <AgencyHeader agency={agency} titleEn="Quotation" titleAr="عرض سعر" />
      <table>
        <tbody>
          <tr><th>{t("pdf.number")}</th><td className="num">{d.number} (v{d.versionNo})</td></tr>
          <tr><th>{t("pdf.date")}</th><td className="num">{d.date}</td></tr>
          <tr><th>{t("pdf.validUntil")}</th><td className="num">{d.validUntil}</td></tr>
          <tr><th>{t("booking.customer")}</th><td>{d.customer}</td></tr>
        </tbody>
      </table>
      <h2>{t("booking.services")}</h2>
      <table>
        <thead><tr><th>{t("item.serviceType")}</th><th>{t("item.description")}</th><th>{t("item.date")}</th>{d.showItemPrices && <th className="num">{t("booking.total")}</th>}</tr></thead>
        <tbody>{d.items.map((i, n) => <tr key={n}><td>{t(`service.${i.type}`)}</td><td>{i.description}</td><td className="num">{i.dates}</td>{d.showItemPrices && <td className="num">{money(i.total, d.currency)}</td>}</tr>)}</tbody>
      </table>
      <table className="totals" style={{ marginTop: 8, width: "50%", marginInlineStart: "auto" }}>
        <tbody>
          <tr><td>{t("booking.subtotal")}</td><td className="num">{money(d.totals.sell, d.currency)}</td></tr>
          <tr><td>{t("booking.tax")}</td><td className="num">{money(d.totals.tax, d.currency)}</td></tr>
          <tr className="grand"><td>{t("booking.total")}</td><td className="num">{money(d.totals.grand, d.currency)}</td></tr>
        </tbody>
      </table>
      {d.customerNotes && <p style={{ whiteSpace: "pre-line" }}>{d.customerNotes}</p>}
      <h2>{t("pdf.terms")}</h2>
      <p style={{ whiteSpace: "pre-line" }}>{d.terms || t("pdf.defaultTerms")}</p>
      <p className="muted">{t("pdf.subjectToAvailability")}</p>
      <Footer agency={agency} />
    </>
  ), locale === "ar" ? "rtl" : "ltr");
}

// ───────── Booking confirmation and vouchers (QT-08/09) ─────────

export type ConfirmationDoc = {
  reference: string; customer: string; currency: string; passengers: string[]; customerNotes: string | null;
  entries: { date: string; time: string | null; kind: string; title: string; detail: string | null }[];
  confirmations: { description: string; confirmation: string | null }[];
  totals: { grand: string; paid: string; balance: string };
};

export function confirmationHtml(agency: Agency, d: ConfirmationDoc, locale: Locale) {
  const t = translator(locale);
  return page(`${t("pdf.confirmation")} ${d.reference}`, agency, (
    <>
      <AgencyHeader agency={agency} titleEn="Booking Confirmation" titleAr="تأكيد الحجز" />
      <table><tbody>
        <tr><th>{t("pdf.bookingRef")}</th><td className="num">{d.reference}</td></tr>
        <tr><th>{t("booking.customer")}</th><td>{d.customer}</td></tr>
        <tr><th>{t("booking.passengers")}</th><td className="ltr">{d.passengers.join(", ")}</td></tr>
      </tbody></table>
      <h2>{t("booking.itinerary")}</h2>
      <table><tbody>{d.entries.map((e, i) => <tr key={i}><td className="num">{e.date} {e.time ?? ""}</td><td>{t(`itinerary.${e.kind}`)}</td><td>{e.title}{e.detail && <div className="muted ltr">{e.detail}</div>}</td></tr>)}</tbody></table>
      <h2>{t("pdf.confirmations")}</h2>
      <table><tbody>{d.confirmations.map((c, i) => <tr key={i}><td>{c.description}</td><td className="num">{c.confirmation ?? "—"}</td></tr>)}</tbody></table>
      <table className="totals" style={{ marginTop: 8, width: "50%", marginInlineStart: "auto" }}><tbody>
        <tr className="grand"><td>{t("booking.total")}</td><td className="num">{money(d.totals.grand, d.currency)}</td></tr>
        <tr><td>{t("booking.paid")}</td><td className="num">{money(d.totals.paid, d.currency)}</td></tr>
        <tr><td>{t("booking.balance")}</td><td className="num">{money(d.totals.balance, d.currency)}</td></tr>
      </tbody></table>
      {d.customerNotes && <p style={{ whiteSpace: "pre-line" }}>{d.customerNotes}</p>}
      <Footer agency={agency} />
    </>
  ), locale === "ar" ? "rtl" : "ltr");
}

export type VoucherDoc = { reference: string; type: string; description: string; dates: string; supplier: string | null; supplierPhone: string | null; confirmation: string | null; passengers: string[]; details: [string, string][] };

export function voucherHtml(agency: Agency, d: VoucherDoc, locale: Locale) {
  const t = translator(locale);
  return page(`${t("pdf.voucher")} ${d.reference}`, agency, (
    <>
      <AgencyHeader agency={agency} titleEn="Service Voucher" titleAr="قسيمة خدمة" />
      <table><tbody>
        <tr><th>{t("pdf.bookingRef")}</th><td className="num">{d.reference}</td></tr>
        <tr><th>{t("item.serviceType")}</th><td>{t(`service.${d.type}`)}</td></tr>
        <tr><th>{t("item.description")}</th><td>{d.description}</td></tr>
        <tr><th>{t("item.date")}</th><td className="num">{d.dates}</td></tr>
        <tr><th>{t("item.supplierConfirmation")}</th><td className="num"><b>{d.confirmation ?? "—"}</b></td></tr>
        {d.supplier && <tr><th>{t("item.supplier")}</th><td>{d.supplier} {d.supplierPhone && <span className="ltr">· {d.supplierPhone}</span>}</td></tr>}
        <tr><th>{t("booking.passengers")}</th><td className="ltr">{d.passengers.join(", ") || "—"}</td></tr>
        {d.details.map(([k, v]) => <tr key={k}><th>{t(k)}</th><td>{v}</td></tr>)}
      </tbody></table>
      <p className="muted">{t("pdf.emergency")} <span className="ltr">{agency.phone ?? ""}</span></p>
      <Footer agency={agency} />
    </>
  ), locale === "ar" ? "rtl" : "ltr");
}
