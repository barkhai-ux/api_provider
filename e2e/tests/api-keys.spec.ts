import { expect, test } from "@playwright/test";
import { API_URL, createKey, register } from "./helpers";

test("developer registers, creates a key, calls the API, and revokes the key", async ({ page, request }) => {
  await register(page);
  await expect(page.getByRole("heading", { level: 1, name: /welcome/i })).toBeVisible();

  const secret = await createKey(page, "E2E key");

  // The secret is never shown again: the list only has the masked form.
  const card = page.getByRole("row", { name: "API key E2E key" });
  await expect(card).toContainText(/geo_live_[A-Za-z0-9]{4}•+/);
  await expect(page.locator("body")).not.toContainText(secret);

  // The new key authenticates against the public API. Data endpoints may answer
  // 503 when no ArcGIS layer is configured; authentication must still pass.
  const ok = await request.get(`${API_URL}/v1/geocode`, {
    params: { q: "Ulaanbaatar" },
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect([200, 503]).toContain(ok.status());
  expect(ok.headers()["x-ratelimit-limit"]).toBe("100");

  // Usage appears in the dashboard (recorded asynchronously, shown live).
  await page.goto("/dashboard");
  await expect(page.getByRole("cell", { name: "/v1/geocode" }).first()).toBeVisible({ timeout: 20_000 });

  // Revoke and verify the API rejects the key.
  await page.goto("/dashboard/api-keys");
  await page.getByRole("button", { name: "Actions for E2E key" }).click();
  await page.getByRole("menuitem", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Revoke key" }).click();
  await expect(page.getByText(/revoked keys/i)).toBeVisible();

  const revoked = await request.get(`${API_URL}/v1/geocode`, {
    params: { q: "Ulaanbaatar" },
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(revoked.status()).toBe(403);
  expect((await revoked.json()).error.code).toBe("API_KEY_REVOKED");
});

test("invalid keys get the standard error envelope", async ({ request }) => {
  const response = await request.get(`${API_URL}/v1/geocode`, {
    params: { q: "Ulaanbaatar" },
    headers: { Authorization: "Bearer geo_live_" + "x".repeat(32) },
  });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({
    error: { code: "INVALID_API_KEY", message: "The API key is missing or invalid." },
  });
});

test("dashboard requires sign-in", async ({ page }) => {
  await page.goto("/dashboard/api-keys");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fapi-keys/);
});
