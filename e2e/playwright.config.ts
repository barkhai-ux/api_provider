import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running stack (`docker compose up` or the local
 * dev servers). Covers Browser -> Next.js -> API gateway -> Convex, and the
 * ArcGIS-backed endpoints when a data source is configured.
 *
 *   E2E_BASE_URL  website (default http://localhost:3000)
 *   E2E_API_URL   public API (default http://localhost:8000)
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "../playwright-report", open: "never" }]],
  outputDir: "../test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /responsive|map/ },
  ],
});
