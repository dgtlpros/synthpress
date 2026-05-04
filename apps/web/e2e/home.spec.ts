import { test, expect } from "@playwright/test";

test("homepage loads successfully", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/SynthPress/i);
});

test("homepage has visible content", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
});
