import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
export const PASSWORD = "Correct-Horse-Battery-42";
export const uniq = () => Math.random().toString(36).slice(2, 8);

export async function mailLink(to: string, pattern: RegExp): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    for (const m of messages ?? []) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string };
      const match = msg.Text.match(pattern);
      if (match) return match[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to} matching ${pattern}`);
}

export async function noA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** Sign up, verify through the real email, land on the dashboard (English UI). */
export async function signUpAgency(page: Page, baseURL: string, id: string) {
  const email = `owner-${id}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Agency legal name").fill(`E2E Travel ${id}`);
  await page.getByLabel("Agency address").fill(`e2e-${id}`);
  await page.getByLabel("Your name").fill("Owner E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Language").selectOption("en");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const host = new URL(baseURL).host.replace(/\./g, "\\.");
  await page.goto(await mailLink(email, new RegExp(`http://${host}/api/auth/verify-email\\S+`)));
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  return email;
}
