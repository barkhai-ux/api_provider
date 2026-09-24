import { expect, test } from "@playwright/test";

// Secrets and internal details that must never reach browser code. The public
// basemap (basemaps.arcgis.com VectorTileServer) is allowed; the internal data
// services (FeatureServer, GeocodeServer, NAServer) and their host are not.
const internalHosts = [process.env.ARCGIS_GEOCODE_SERVER, process.env.ARCGIS_ROUTE_SERVICE]
  .filter((url): url is string => Boolean(url))
  .map((url) => new RegExp(new URL(url).host.replace(/\./g, "\\.")));
const FORBIDDEN = [
  /\bgeo_[A-Za-z0-9]{32}\b/,
  /geo_live_[A-Za-z0-9]{32}/,
  /geo_test_[A-Za-z0-9]{32}/,
  /FeatureServer|GeocodeServer|NAServer/,
  /GATEWAY_SECRET|API_KEY_PEPPER|API_INTERNAL_URL|ARCGIS_CLIENT_SECRET/,
  /arcgis\.ubhub\.mn/,
  ...internalHosts,
];

test("client bundles contain no API keys, secrets or ArcGIS details", async ({ page }) => {
  const scripts = new Map<string, string>();
  page.on("response", async (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (type.includes("javascript")) scripts.set(response.url(), await response.text().catch(() => ""));
  });
  for (const path of ["/", "/developers", "/developers/api-reference", "/login", "/dashboard"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(scripts.size).toBeGreaterThan(0);
  for (const [url, body] of scripts) {
    for (const pattern of FORBIDDEN) {
      expect(pattern.test(body), `${pattern} found in ${url}`).toBe(false);
    }
  }
});

test("public API responses carry security headers", async ({ request }) => {
  const api = (process.env.E2E_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
  const response = await request.get(`${api}/v1/geocode?q=ab`);
  expect(response.status()).toBe(401);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["cache-control"]).toBe("no-store");
});
