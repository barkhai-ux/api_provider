import { expect, test } from "@playwright/test";

test("interface language switches between English and Mongolian", async ({ page, context }) => {
  // Default: English.
  await page.goto("/developers");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Location APIs for Mongolia" })).toBeVisible();

  // The Mongolian cookie re-renders server components in Mongolian.
  await context.addCookies([{ name: "locale", value: "mn", url: "http://localhost:3000" }]);
  await page.goto("/developers");
  await expect(page.locator("html")).toHaveAttribute("lang", "mn");
  await expect(page.getByRole("heading", { name: "Монголд зориулсан байршлын API" })).toBeVisible();
  // Navigation is translated too.
  await expect(page.getByRole("link", { name: "Газрын зураг" })).toBeVisible();
});

test("the language button switches immediately on click", async ({ page }) => {
  await page.goto("/developers");
  // English by default; the button offers the other language.
  const toMongolian = page.getByRole("button", { name: /Монгол|Switch to/ });
  await toMongolian.click();
  await expect(page.locator("html")).toHaveAttribute("lang", "mn");
  await expect(page.getByRole("heading", { name: "Монголд зориулсан байршлын API" })).toBeVisible();
  // Now it offers English; one click switches back.
  await page.getByRole("button", { name: /English|рүү сэлгэх/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
