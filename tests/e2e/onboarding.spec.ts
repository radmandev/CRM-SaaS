import { expect, test } from "@playwright/test";
import { mailLink, noA11yViolations, PASSWORD, uniq } from "./support";

// Phase 1 acceptance journey: sign up → verify via real email → set up agency → invite → invitee accepts →
// role-restricted navigation. Every visited page is scanned with axe (§25.4, AC-G7), in both languages.

test("agency onboarding end to end", async ({ page, browser, baseURL }, info) => {
  const id = `${uniq()}${info.project.name.slice(0, 1)}`;
  const ownerEmail = `owner-${id}@example.com`;
  const origin = new URL(baseURL!).host;

  // Sign up (English UI via Accept-Language), check email page.
  await page.goto("/signup");
  await noA11yViolations(page);
  await page.getByLabel("Agency legal name").fill(`E2E Travel ${id}`);
  await page.getByLabel("Agency address").fill(`e2e-${id}`);
  await page.getByLabel("Your name").fill("Owner E2E");
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Language").selectOption("en");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  // Login is refused until the email is confirmed.
  await page.goto("/login");
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Confirm your email first" })).toBeVisible();

  // Real verification email (worker → SMTP → Mailpit).
  const verify = await mailLink(ownerEmail, new RegExp(`http://${origin.replace(".", "\\.")}/api/auth/verify-email\\S+`));
  await page.goto(verify);
  await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Invite your team")).toBeVisible();
  await noA11yViolations(page);

  // Agency settings: client-side validation, then a real save.
  await page.goto("/settings/agency");
  await noA11yViolations(page);
  await page.getByLabel("Commercial registration (CR)").fill("123");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("CR number must be 10 digits")).toBeVisible();
  await page.getByLabel("Commercial registration (CR)").fill("1010123456");
  await page.getByLabel("City").fill("Riyadh");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  // Every other settings page renders and passes axe.
  for (const path of ["/settings/branches", "/settings/tax-rates", "/settings/currencies", "/settings/numbering", "/settings/audit-log", "/account"]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    await noA11yViolations(page);
  }
  await page.goto("/settings/audit-log");
  await expect(page.getByText("tenant.settings_updated")).toBeVisible();

  // Invite a sales agent.
  const agentEmail = `agent-${id}@example.com`;
  await page.goto("/settings/users");
  await noA11yViolations(page);
  const inviteForm = page.locator("section", { has: page.getByRole("heading", { name: "Invite a team member" }) });
  await inviteForm.getByLabel("Email").fill(agentEmail);
  await inviteForm.getByLabel("Role").selectOption("SALES_AGENT");
  await inviteForm.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation queued for sending")).toBeVisible();

  // The invitee accepts in a fresh browser, in Arabic.
  const invite = await mailLink(agentEmail, new RegExp(`http://${origin.replace(".", "\\.")}/invite/[\\w-]+`));
  const ctx = await browser.newContext({ locale: "ar-SA", extraHTTPHeaders: { "accept-language": "ar" }, viewport: page.viewportSize() ?? undefined });
  const agent = await ctx.newPage();
  await agent.goto(invite);
  await expect(agent.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(agent.getByRole("heading", { name: /انضم إلى/ })).toBeVisible();
  await noA11yViolations(agent);
  await agent.getByLabel("اسمك").fill("Agent E2E");
  await agent.getByLabel("كلمة المرور").fill(PASSWORD);
  await agent.getByRole("button", { name: "قبول الدعوة" }).click();
  await expect(agent.getByRole("heading", { name: "لوحة التحكم" })).toBeVisible();
  await expect(agent.getByText("موظف مبيعات").first()).toBeVisible();
  await noA11yViolations(agent);

  // Role-restricted navigation and server-side enforcement.
  await expect(agent.getByRole("link", { name: "الوكالة" })).toHaveCount(0);
  await agent.goto("/settings/agency");
  await expect(agent.getByText("لا توجد صلاحية")).toBeVisible();
  const api = await agent.request.patch("/api/v1/agency", { data: {}, headers: { origin: baseURL! } });
  expect(api.status()).toBe(403);
  await ctx.close();
});
