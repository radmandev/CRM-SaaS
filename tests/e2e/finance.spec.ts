import { expect, test, type Locator, type Page } from "@playwright/test";
import { noA11yViolations, signUpAgency, uniq } from "./support";

async function pickCustomer(select: Locator, id: string) {
  await select.selectOption((await select.locator("option", { hasText: `Alharbi${id}` }).getAttribute("value"))!);
}

const exact = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\*)?$`);
const saved = (page: Page, path: string, method = "PATCH") =>
  page.waitForResponse((r) => new URL(r.url()).pathname === path && r.request().method() === method);

// Phase 3 acceptance journey (SPEC §27 Phase 3): quotation → booking → invoice (ZATCA QR, PDF) → payment →
// credit note → refund, all through the UI.
test("quotation to paid invoice, credit note and refund", async ({ page, baseURL }, info) => {
  test.setTimeout(300_000); // ~13 page loads, 5 axe scans and a PDF render on a small CI VM
  const id = `${uniq()}${info.project.name.slice(0, 1)}`;
  page.on("dialog", (d) => d.accept());
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "Create your agency account" }).first()).toBeVisible();
  await noA11yViolations(page);
  await signUpAgency(page, baseURL!, id);

  // ONB-01: the seller details a tax invoice needs.
  await page.goto("/settings/agency");
  await page.getByLabel("Registered for VAT").check();
  await page.getByLabel(exact("VAT registration number")).fill("300000000000003");
  await page.getByLabel(exact("VAT registration date")).fill("2024-01-01");
  await page.getByLabel(exact("Building number")).fill("1234");
  await page.getByLabel(exact("Street")).fill("King Fahd Road");
  await page.getByLabel(exact("City")).fill("Riyadh");
  await page.getByLabel(exact("Postal code")).fill("12345");
  let res = saved(page, "/api/v1/agency");
  await page.getByRole("button", { name: "Save" }).click();
  expect((await res).ok()).toBe(true);

  // A small agency where the owner also approves refunds (REF-01 setting).
  await page.goto("/settings/finance");
  await noA11yViolations(page);
  await page.getByLabel("Allow approving your own refund requests").check();
  res = saved(page, "/api/v1/agency/finance");
  await page.getByRole("button", { name: "Save" }).click();
  expect((await res).ok()).toBe(true);

  await page.goto("/customers");
  const add = page.locator("section", { has: page.getByRole("heading", { name: "Add customer" }) });
  await add.getByLabel(exact("First name")).fill("Huda");
  await add.getByLabel(exact("Last name")).fill(`Alharbi${id}`);
  await add.getByLabel(exact("Phone")).fill("0501234567");
  await add.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Huda Alharbi${id}`) })).toBeVisible();

  // Quotation with a hotel, marked as sent, accepted, converted.
  await page.goto("/quotations");
  await pickCustomer(page.getByLabel(exact("Customer")), id);
  await page.getByRole("button", { name: "Create quotation" }).click();
  await expect(page).toHaveURL(/\/quotations\/[0-9a-f-]{36}$/);
  const svc = page.locator("form", { has: page.getByLabel("Service type") });
  await svc.getByLabel("Service type").selectOption("HOTEL");
  await svc.getByLabel(exact("Hotel")).fill("Rosewood Jeddah");
  await svc.getByLabel(exact("City")).fill("Jeddah");
  await svc.getByLabel("Check-in").fill("2026-12-01");
  await svc.getByLabel("Check-out").fill("2026-12-04");
  await svc.getByLabel("Room type").fill("Deluxe Sea View");
  await svc.getByLabel(exact("Selling price")).fill("2400");
  await svc.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByText("Rosewood Jeddah, Jeddah").first()).toBeVisible();
  await noA11yViolations(page);
  await page.getByRole("button", { name: "Mark as sent (shared another way)" }).click();
  await expect(page.getByRole("heading", { name: /^QT-\d{4}-\d{6} v1$/ })).toBeVisible();
  await page.getByRole("button", { name: "Record acceptance" }).click();
  await page.getByRole("button", { name: "Convert to booking" }).click();
  await page.getByRole("link", { name: /^BK-\d{4}-\d{6}$/ }).click();
  await expect(page.getByRole("heading", { name: /^BK-\d{4}-\d{6}$/ })).toBeVisible();

  // Invoice from the booking, issued with a number and the ZATCA QR code.
  await page.getByRole("button", { name: "Create draft invoice" }).click();
  await page.getByRole("link", { name: "Draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Draft invoice" })).toBeVisible();
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByRole("heading", { name: /^Simplified tax invoice INV-\d{4}-\d{6}$/ })).toBeVisible();
  await expect(page.getByAltText("ZATCA QR code of this invoice")).toBeVisible();
  await expect(page.getByRole("button", { name: "Issue invoice" })).toHaveCount(0); // locked once issued
  const invoiceUrl = page.url();
  await noA11yViolations(page);

  // Full payment applied to the invoice.
  const pay = page.locator("section", { has: page.getByRole("heading", { name: "Record payment" }) });
  await pay.getByLabel(exact("Reference")).fill("TRX-77812");
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(page.locator("main").getByText("Paid", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments applied" })).toBeVisible();

  // Credit note for part of the stay; the customer is now in credit.
  await page.getByLabel(/^Reason \(required by ZATCA\)/).fill("One night cancelled by the customer");
  await page.getByLabel(/^Amount to credit/).fill("500");
  await page.getByRole("button", { name: "Issue credit note" }).click();
  await expect(page.getByRole("link", { name: /^CN-\d{4}-\d{6}$/ })).toBeVisible();

  // Refund of the credit: requested, approved, paid.
  await page.goto("/refunds");
  const req = page.locator("section", { has: page.getByRole("heading", { name: "Request refund" }) });
  await pickCustomer(req.getByLabel(exact("Customer")), id);
  await req.getByLabel(exact("Amount")).fill("500");
  await req.getByLabel(exact("Reason")).fill("Cancelled night");
  await req.getByRole("button", { name: "Request refund" }).click();
  const refund = page.locator("li", { hasText: /RF-\d{4}-\d{6}/ }).first();
  await expect(refund.getByText("Awaiting approval")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(refund.getByText("Approved, not paid")).toBeVisible();
  await refund.locator("summary", { hasText: "Mark as paid" }).click();
  await refund.getByRole("button", { name: "Mark as paid" }).click();
  await expect(refund.getByText("Paid", { exact: true })).toBeVisible();
  await noA11yViolations(page);

  // The worker renders the invoice PDF once; it downloads as a real PDF.
  await page.goto(invoiceUrl);
  const pdfLink = page.getByRole("link", { name: /^INV-\d{4}-\d{6}.*\.pdf$/ });
  await expect(async () => {
    await page.reload();
    await expect(pdfLink).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 90_000 });
  const pdf = await page.request.get((await pdfLink.getAttribute("href"))!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  // Reports reflect the documents.
  await page.goto("/reports/sales");
  await expect(page.getByText("Invoiced", { exact: true })).toBeVisible();
  await noA11yViolations(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Finance" })).toBeVisible();
});
