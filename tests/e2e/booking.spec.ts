import { expect, test } from "@playwright/test";
import { noA11yViolations, signUpAgency, uniq } from "./support";

/** Label text exactly, allowing the required-field asterisk. */
const exact = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\*)?$`);

// Phase 2 acceptance journey (SPEC §27 Phase 2): customer + traveler with passport → booking with flight and
// hotel → passengers → supplier confirmations (recorded manually) → confirm → ticket → itinerary in Arabic.
test("customer to issued booking with itinerary", async ({ page, browser, baseURL }, info) => {
  const id = `${uniq()}${info.project.name.slice(0, 1)}`;
  await signUpAgency(page, baseURL!, id);

  // Supplier.
  await page.goto("/suppliers");
  await noA11yViolations(page);
  const sup = page.locator("section", { has: page.getByRole("heading", { name: "Add supplier" }) });
  await sup.getByLabel("Supplier type").selectOption("CONSOLIDATOR");
  await sup.getByLabel(exact("Code")).fill(`GC${id.slice(0, 4)}`.toUpperCase());
  await sup.getByLabel("Name (English)").fill("Gulf Consolidator");
  await sup.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("heading", { name: "Gulf Consolidator" })).toBeVisible();
  await noA11yViolations(page);

  // Customer with a traveler and passport.
  await page.goto("/customers");
  const add = page.locator("section", { has: page.getByRole("heading", { name: "Add customer" }) });
  await add.getByLabel(exact("First name")).fill("Sara");
  await add.getByLabel(exact("Last name")).fill(`Alqahtani${id}`);
  await add.getByLabel(exact("Phone")).fill("0501234567");
  await add.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Sara Alqahtani${id}`) })).toBeVisible();
  await noA11yViolations(page);
  await page.getByText("Add traveler").click();
  const tr = page.locator("form", { has: page.getByLabel("First name (as in passport)") });
  await tr.getByLabel("First name (as in passport)").fill("Sara");
  await tr.getByLabel("Last name (as in passport)").fill("Alqahtani");
  await tr.getByLabel("Date of birth").fill("1990-05-01");
  await tr.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("SARA ALQAHTANI", { exact: true })).toBeVisible();
  await page.getByText("Add travel document").click();
  const doc = page.locator("form", { has: page.getByLabel("Document number") });
  await doc.getByLabel("Document number").fill("A1234567");
  await doc.getByLabel("Expiry date").fill("2031-01-01");
  await doc.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("•••••4567")).toBeVisible();
  await expect(page.getByText("A1234567")).toHaveCount(0);
  await page.getByRole("button", { name: "Show" }).first().click();
  await expect(page.getByText("A1234567")).toBeVisible(); // revealed on request, audited server-side

  // Booking with a flight and a hotel.
  await page.getByRole("button", { name: "New booking" }).click();
  await expect(page.getByRole("heading", { name: /^BK-\d{4}-\d{6}$/ })).toBeVisible();
  const svc = page.locator("form", { has: page.getByLabel("Service type") });
  await svc.getByLabel(exact("Supplier")).selectOption({ label: "Gulf Consolidator" });
  await svc.getByLabel("Airline (IATA)").fill("SV");
  await svc.getByLabel("Flight number").fill("1020");
  await svc.getByLabel("From (airport)").fill("RUH");
  await svc.getByLabel("To (airport)").fill("JED");
  await svc.getByLabel("Departure (local time)").fill("2026-12-01T08:00");
  await svc.getByLabel("Arrival (local time)").fill("2026-12-01T09:45");
  await svc.getByLabel(exact("Selling price")).fill("950");
  await svc.getByLabel(exact("Supplier cost")).fill("800");
  await svc.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByText("RUH–JED (SV1020)")).toBeVisible();

  await page.getByText("Add service").first().click();
  const svc2 = page.locator("form", { has: page.getByLabel("Service type") });
  await svc2.getByLabel("Service type").selectOption("HOTEL");
  await svc2.getByLabel(exact("Hotel")).fill("Rosewood Jeddah");
  await svc2.getByLabel(exact("City")).fill("Jeddah");
  await svc2.getByLabel("Check-in").fill("2026-12-01");
  await svc2.getByLabel("Check-out").fill("2026-12-04");
  await svc2.getByLabel("Room type").fill("Deluxe Sea View");
  await svc2.getByLabel(exact("Selling price")).fill("2400");
  await svc2.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByText("Rosewood Jeddah, Jeddah").first()).toBeVisible();
  await noA11yViolations(page);

  // Passenger from the profile, assigned to the flight.
  await page.getByRole("button", { name: "Add from profile" }).click();
  await expect(page.getByText("Lead passenger").first()).toBeVisible();
  const flight = page.locator("li", { hasText: "RUH–JED (SV1020)" }).first();
  await flight.getByText("Travellers").click();
  const paxForm = flight.locator("form", { has: page.getByRole("checkbox") });
  await paxForm.getByRole("checkbox").check();
  await paxForm.getByRole("button", { name: "Save" }).click();
  await expect(flight.getByText("SARA ALQAHTANI", { exact: true })).toBeVisible();

  // Record supplier confirmations, confirm the booking, issue the ticket.
  const statusForm = (item: typeof flight) => item.locator("form", { has: page.getByLabel(exact("Status")) });
  await flight.getByText("Update status").click();
  await statusForm(flight).getByLabel(exact("Status")).selectOption("CONFIRMED");
  await statusForm(flight).getByLabel("PNR / airline locator").fill("XYZ123");
  await statusForm(flight).getByRole("button", { name: "Save" }).click();
  await expect(flight.getByText("XYZ123")).toBeVisible();
  const hotel = page.locator("li", { hasText: "Rosewood Jeddah" }).first();
  await hotel.getByText("Update status").click();
  await statusForm(hotel).getByLabel(exact("Status")).selectOption("CONFIRMED");
  await statusForm(hotel).getByLabel("Supplier confirmation no.").fill("RW-55821");
  await statusForm(hotel).getByRole("button", { name: "Save" }).click();
  await expect(hotel.getByText("RW-55821")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("button", { name: "Confirm booking" })).toHaveCount(0);
  await expect(page.locator("main").getByText("Confirmed").first()).toBeVisible();
  await statusForm(flight).getByLabel(exact("Status")).selectOption("ISSUED");
  await statusForm(flight).getByLabel(/Ticket number/).fill("0651234567890");
  await statusForm(flight).getByRole("button", { name: "Save" }).click();
  await expect(flight.getByText("0651234567890")).toBeVisible();

  // Customer itinerary link, opened without login in Arabic.
  await page.getByRole("button", { name: "Customer itinerary link" }).click();
  const link = await page.getByLabel("Itinerary link").inputValue();
  const ctx = await browser.newContext({ locale: "ar-SA", extraHTTPHeaders: { "accept-language": "ar" } });
  const pub = await ctx.newPage();
  await pub.goto(link);
  await expect(pub.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(pub.getByText("SV1020 RUH → JED")).toBeVisible();
  await expect(pub.getByText("A1234567")).toHaveCount(0);
  await expect(pub.getByText("4567")).toHaveCount(0);
  await noA11yViolations(pub);
  await ctx.close();
});
