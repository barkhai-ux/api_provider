import { expect, test } from "@playwright/test";
import { createKey, register } from "./helpers";

test("the API reference playground calls the API with a connected key", async ({ page }) => {
  await register(page);
  await createKey(page, "Playground key");

  await page.goto("/developers/api-reference");
  const playground = page.getByRole("region", { name: /geocode playground/i }).first();
  await expect(playground.getByRole("combobox", { name: "API key" })).toContainText("Playground key");
  await playground.getByRole("button", { name: "Send request" }).click();

  // 200 with data, or 503 when no geocoding layer is configured. Never an auth failure.
  const status = playground.getByTestId("status-line");
  await expect(status).toHaveText(/^(200|503)/);
  await expect(playground.getByTestId("curl")).toContainText("YOUR_API_KEY");
  await expect(playground.getByTestId("curl")).not.toContainText("geo_pt_");
});
