import { test, expect } from "@playwright/test";

test("homepage loads successfully", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/SynthPress/i);
});

test("homepage shows hero headline", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("AI-Powered Blog Publishing");
});

test("homepage has pricing section", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#pricing")).toBeVisible();
});
