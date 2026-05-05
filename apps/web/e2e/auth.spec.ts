import { test, expect } from "@playwright/test";

test("login page loads with navbar and footer", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.locator("footer")).toBeVisible();
});

test("signup page loads with navbar and footer", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.locator("footer")).toBeVisible();
});

test("login page has link to signup", async ({ page }) => {
  await page.goto("/login");
  const signUpLink = page.getByRole("link", { name: "Sign up" });
  await expect(signUpLink).toBeVisible();
  await expect(signUpLink).toHaveAttribute("href", "/signup");
});

test("signup page has link to login", async ({ page }) => {
  await page.goto("/signup");
  const loginLink = page.getByRole("link", { name: "Sign in" });
  await expect(loginLink).toBeVisible();
  await expect(loginLink).toHaveAttribute("href", "/login");
});

test("unauthenticated user is redirected from /dashboard to /login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("unauthenticated user is redirected from /account to /login", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login/);
});
