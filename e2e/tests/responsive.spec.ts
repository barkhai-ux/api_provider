import { expect, test } from "@playwright/test";

const PAGES = ["/", "/developers", "/developers/docs", "/developers/docs/routing", "/developers/api-reference", "/login", "/register"];

for (const path of PAGES) {
  test(`no horizontal overflow on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
