import { expect, type Page } from "@playwright/test";

export const API_URL = (process.env.E2E_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

export async function register(page: Page, email = uniqueEmail(), password = "e2e-password-123") {
  await page.goto("/register");
  await page.getByLabel("Name").fill("E2E Developer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return { email, password };
}

/** Creates a key in the dashboard and returns the one-time secret. */
export async function createKey(page: Page, name: string): Promise<string> {
  await page.goto("/dashboard/api-keys");
  await page.getByRole("button", { name: "Create API key" }).first().click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create key" }).click();
  const secretField = page.getByLabel("API key", { exact: true });
  await expect(secretField).toHaveValue(/^geo_live_[A-Za-z0-9]{32}$/);
  const secret = await secretField.inputValue();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(secretField).toBeHidden();
  return secret;
}
