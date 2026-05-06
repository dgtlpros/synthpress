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

test("navbar has Log In link pointing to /login", async ({ page }) => {
  await page.goto("/");
  const loginLink = page.getByRole("link", { name: "Log In" });
  await expect(loginLink).toBeVisible();
  await expect(loginLink).toHaveAttribute("href", "/login");
});

test("navbar has Sign Up link pointing to /signup", async ({ page }) => {
  await page.goto("/");
  const signUpLink = page.getByRole("link", { name: "Sign Up" });
  await expect(signUpLink).toBeVisible();
  await expect(signUpLink).toHaveAttribute("href", "/signup");
});

test("hero Get Started CTA points to /signup", async ({ page }) => {
  await page.goto("/");
  const heroCta = page
    .locator("section")
    .getByRole("link", { name: "Get Started" });
  await expect(heroCta).toHaveAttribute("href", "/signup");
});
