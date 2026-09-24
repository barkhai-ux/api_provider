import { expect, test } from "@playwright/test";

test("documentation navigation", async ({ page }) => {
  await page.goto("/developers/docs");
  const nav = page.getByRole("navigation", { name: /documentation/i }).first();
  await nav.getByRole("link", { name: "Geocoding", exact: true }).click();
  await expect(page).toHaveURL(/\/developers\/docs\/geocoding$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/geocoding/i);
  await expect(nav.getByRole("link", { name: "Geocoding", exact: true })).toHaveAttribute("aria-current", "page");

  for (const slug of ["getting-started", "authentication", "reverse-geocoding", "routing", "errors", "rate-limits", "versioning", "examples"]) {
    const response = await page.goto(`/developers/docs/${slug}`);
    expect(response?.status(), slug).toBe(200);
  }
  await page.goto("/developers/docs/errors");
  for (const code of ["INVALID_REQUEST", "INVALID_API_KEY", "API_KEY_REVOKED", "RATE_LIMIT_EXCEEDED", "UPSTREAM_ERROR"]) {
    await expect(page.getByText(code).first()).toBeAttached();
  }
});

test("OpenAPI schema is served by the API", async ({ request }) => {
  const api = (process.env.E2E_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
  const schema = await (await request.get(`${api}/openapi.json`)).json();
  expect(Object.keys(schema.paths)).toEqual(expect.arrayContaining(["/v1/geocode", "/v1/reverse-geocode", "/v1/route"]));
});
