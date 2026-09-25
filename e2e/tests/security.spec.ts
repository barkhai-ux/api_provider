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
  // No server software banner (nmap identified "Uvicorn" from it).
  expect(response.headers()["server"]).toBeUndefined();
});

test("pages get a fresh CSP nonce that covers every inline script", async ({ request }) => {
  const nonces = new Set<string>();
  for (const path of ["/", "/developers/docs", "/login"]) {
    const response = await request.get(path);
    const policy = response.headers()["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    expect(nonce, `nonce on ${path}`).toBeTruthy();
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).toContain("frame-ancestors 'none'");
    nonces.add(nonce!);
    const html = await response.text();
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
      expect(tag, `script without nonce on ${path}`).toContain(`nonce="${nonce}"`);
    }
  }
  expect(nonces.size).toBe(3);
});

test("no Content-Security-Policy violations on the main pages", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(message.text())) violations.push(message.text());
  });
  for (const path of ["/", "/developers", "/developers/docs/getting-started", "/developers/api-reference", "/login"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(violations).toEqual([]);
});

test("the sign-in redirect cannot leave the site", async ({ page }) => {
  // Browsers drop the tab: "/\t/evil.example" would become "//evil.example".
  await page.goto("/register?next=%2F%09%2Fevil.example");
  await page.getByLabel("Name").fill("Redirect Test");
  await page.getByLabel("Email").fill(`redirect-${Date.now()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  expect(page.url()).not.toContain("evil.example");
});

test("the map proxy is not a general proxy", async ({ request }) => {
  expect((await request.get("/api/v1/proxy?url=https://example.com")).status()).toBe(404);
  const extra = await request.get("/api/v1/geocode?q=sukh&url=https://example.com");
  expect(extra.status()).toBe(400);
  const duplicated = await request.get("/api/v1/geocode?q=sukh&q=other");
  expect(duplicated.status()).toBe(400);
  const nan = await request.get("/api/v1/reverse-geocode?lat=NaN&lon=106.9");
  expect(nan.status()).toBe(400);
});

test("the API refuses ambiguous requests before authentication", async ({ request }) => {
  const api = (process.env.E2E_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
  expect((await request.get(`${api}/v1/geocode?q=ab&q=cd`)).status()).toBe(400);
  expect((await request.get(`${api}/v1/geocode?q=${"x".repeat(3000)}`)).status()).toBe(414);
});
