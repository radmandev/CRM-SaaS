import { chromium, type Browser } from "playwright-core";
import { env } from "./env";

// D-13: HTML → PDF with headless Chromium (correct Arabic shaping and bidi). One browser per worker process.
let browser: Promise<Browser> | undefined;

export class PdfNotConfigured extends Error {}

export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const path = env().CHROME_PATH;
  if (!path) throw new PdfNotConfigured("PDF rendering is not configured (set CHROME_PATH)");
  browser ??= chromium.launch({ executablePath: path, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await (await browser).newPage({ javaScriptEnabled: false });
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ format: "A4", printBackground: true, margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" } });
  } finally {
    await page.close();
  }
}

export async function closePdfBrowser() {
  if (browser) await (await browser).close();
  browser = undefined;
}
