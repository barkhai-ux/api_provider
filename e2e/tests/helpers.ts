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

/**
 * Creates a key in the dashboard and returns its secret. `without` lists
 * endpoint labels to untick (all endpoints are ticked by default); `expiry` is
 * an option of the Expiration select (default "90 days").
 */
export async function createKey(
  page: Page,
  name: string,
  options: { without?: string[]; expiry?: string } = {},
): Promise<string> {
  await page.goto("/dashboard/api-keys");
  await page.getByRole("button", { name: "Create API key" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create API key" });
  await dialog.getByLabel("Name").fill(name);
  for (const label of options.without ?? []) {
    await dialog.getByRole("checkbox", { name: new RegExp(`^${label}`) }).click();
  }
  if (options.expiry) {
    await dialog.getByRole("combobox", { name: "Expiration" }).click();
    await page.getByRole("option", { name: options.expiry }).click();
  }
  await dialog.getByRole("button", { name: "Create key" }).click();
  const secretField = page.getByLabel("API key", { exact: true });
  await expect(secretField).toHaveValue(/^geo_[A-Za-z0-9]{32}$/);
  const secret = await secretField.inputValue();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(secretField).toBeHidden();
  return secret;
}
