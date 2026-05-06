import { test, expect } from "@playwright/test";

// These tests cover the public route surface for team invites. End-to-end
// validation of the full create-invite → copy-link → accept-in-incognito
// flow requires an authenticated session (magic-link round-trip via the
// local Inbucket server) and is left as a manual flow for v1, mirroring
// the billing.spec.ts approach.

test("unauthenticated visit to /teams/invite/<token> redirects to /login", async ({
  page,
}) => {
  await page.goto("/teams/invite/some-test-token");
  await expect(page).toHaveURL(/\/login/);
});

test("unauthenticated visit to /teams/<id>/settings redirects to /login", async ({
  page,
}) => {
  await page.goto("/teams/00000000-0000-0000-0000-000000000000/settings");
  await expect(page).toHaveURL(/\/login/);
});

test("unauthenticated visit to /teams/<id>/usage redirects to /login", async ({
  page,
}) => {
  await page.goto("/teams/00000000-0000-0000-0000-000000000000/usage");
  await expect(page).toHaveURL(/\/login/);
});

test("login page loads when redirected from invite link", async ({ page }) => {
  await page.goto("/teams/invite/abc");
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});
