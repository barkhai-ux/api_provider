import { expect, test } from "@playwright/test";

const place = {
  id: "plc_1",
  name: "Sukhbaatar Square",
  address: "Ulaanbaatar, Mongolia",
  latitude: 47.9189,
  longitude: 106.9176,
  type: "landmark",
};

/**
 * The map talks to /api/v1/* (the site's proxy to the public API). These tests
 * stub those responses in the browser so the UI is checked independently of
 * which data source is configured; api-keys.spec.ts covers the live chain.
 */
test.beforeEach(async ({ page }) => {
  // One geocoding endpoint: forward (q) or reverse (lat/lon).
  await page.route("**/api/v1/geocode?**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("lat")) {
      route.fulfill({
        json: {
          query: "47.92,106.92",
          results: [
            {
              id: "rev_1",
              name: "Chingis Avenue",
              address: "Chingis Avenue, Ulaanbaatar, Mongolia",
              latitude: 47.92,
              longitude: 106.92,
              type: "street",
              distance_meters: 12,
            },
          ],
          count: 1,
        },
      });
      return;
    }
    route.fulfill({ json: { query: "sukh", results: [place], count: 1 }, headers: { "X-RateLimit-Limit": "60" } });
  });
  await page.route("**/api/v1/route?**", (route) =>
    route.fulfill({
      json: {
        route: {
          distance_meters: 4200,
          duration_seconds: 620,
          geometry: { type: "LineString", coordinates: [[106.9176, 47.9189], [106.91, 47.92], [106.9057, 47.922]] },
        },
        mode: "driving",
        waypoints: [],
      },
    }),
  );
});

test("search a place, see it on the map, and plan a route to it", async ({ page, isMobile }) => {
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Search location" });
  await search.fill("sukh");
  await page.getByRole("option", { name: /Sukhbaatar Square/ }).click();

  await expect(page.locator(".geo-popup")).toContainText("Sukhbaatar Square");
  await expect(page.getByRole("img", { name: "Selected place" })).toBeAttached();

  await page.locator(".geo-popup").getByRole("button", { name: "Directions to here" }).click();
  const from = page.getByRole("combobox", { name: "From" });
  await from.fill("sukh");
  await page.getByRole("option", { name: /Sukhbaatar Square/ }).click();

  await expect(page.getByRole("button", { name: "Calculate route" })).toBeEnabled();
  await expect(page.getByText("4.2 km")).toBeVisible();
  await expect(page.getByText("10 min")).toBeVisible();
  expect(isMobile ? await page.getByRole("tab", { name: "Directions" }).getAttribute("aria-selected") : "true").toBe("true");
});

test("clicking the map looks up the address", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.35);
  await expect(page.locator(".geo-popup")).toContainText("Chingis Avenue, Ulaanbaatar, Mongolia");
});
