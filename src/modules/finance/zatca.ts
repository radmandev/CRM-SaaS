// ZAT-02: ZATCA Phase 1 (generation) QR code — Base64 of TLV-encoded tags 1..5:
// seller name, VAT registration number, invoice timestamp (ISO 8601), invoice total with VAT, VAT total.
// Phase 2 adds tags 6..9 (hash, signature, public key, certificate signature) via the EInvoicingProvider (§18.7).

export type QrFields = { sellerName: string; vatNumber: string; timestamp: string; total: string; vatTotal: string };

export function zatcaQr(f: QrFields): string {
  const parts = [f.sellerName, f.vatNumber, f.timestamp, f.total, f.vatTotal].map((value, i) => {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length > 255) throw new Error(`QR tag ${i + 1} is longer than 255 bytes`);
    return Buffer.concat([Buffer.from([i + 1, bytes.length]), bytes]);
  });
  return Buffer.concat(parts).toString("base64");
}

/** Inverse of zatcaQr; used by tests and the invoice view to show what the QR contains. */
export function decodeZatcaQr(b64: string): string[] {
  const buf = Buffer.from(b64, "base64");
  const out: string[] = [];
  for (let i = 0; i < buf.length; ) {
    const len = buf[i + 1];
    out.push(buf.subarray(i + 2, i + 2 + len).toString("utf8"));
    i += 2 + len;
  }
  return out;
}
