import { test, expect } from "@playwright/test";

// These tests cover the public/unauthenticated billing surface and route
// gating. End-to-end validation of the full Stripe checkout flow (test card
// `4242 4242 4242 4242`, webhook fan-out, balance increment) requires the
// Stripe CLI forwarding events to localhost — see apps/web/AGENTS.md.

test("pricing page lists all seeded plans", async ({ page }) => {
  await page.goto("/pricing");
  await expect(
    page.getByRole("heading", { name: /Pricing built around credits/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Starter", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Pro", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Scale", exact: true }),
  ).toBeVisible();
});

test("pricing CTAs route unauthenticated visitors to signup", async ({
  page,
}) => {
  await page.goto("/pricing");
  const cta = page.getByRole("link", { name: "Get Started" }).first();
  await expect(cta).toHaveAttribute("href", /\/signup/);
});

test("unauthenticated user is redirected from /account/billing to /login", async ({
  page,
}) => {
  await page.goto("/account/billing");
  await expect(page).toHaveURL(/\/login/);
});

test("unauthenticated user is redirected from /checkout to /login", async ({
  page,
}) => {
  await page.goto("/checkout?plan=pro");
  await expect(page).toHaveURL(/\/login/);
});

test("/api/webhooks/stripe rejects requests without a signature", async ({
  request,
}) => {
  const response = await request.post("/api/webhooks/stripe", {
    headers: { "Content-Type": "application/json" },
    data: { id: "evt_x", type: "checkout.session.completed" },
  });
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.error).toMatch(/Missing stripe-signature/);
});
