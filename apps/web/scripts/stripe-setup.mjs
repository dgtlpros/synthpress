#!/usr/bin/env node
// @ts-check

/**
 * Idempotently provisions Stripe Products + Prices for SynthPress, then
 * rewrites supabase/seed.sql with the real price ids. Reruns are safe — if a
 * product with a matching metadata key already exists, we reuse it; if a
 * matching active price already exists on that product, we reuse it.
 *
 * Usage:
 *   pnpm stripe:setup          # uses .env.local (test mode by default)
 *   pnpm stripe:setup --live   # opt-in to live mode (requires sk_live_ key)
 */

import Stripe from "stripe";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = resolve(__dirname, "../../../supabase/seed.sql");

const ALLOW_LIVE = process.argv.includes("--live");

const PLANS = [
  {
    key: "starter",
    productName: "SynthPress Starter",
    description: "For solo creators",
    monthlyTokens: 1000,
    unitAmount: 2900,
  },
  {
    key: "pro",
    productName: "SynthPress Pro",
    description: "For growing networks",
    monthlyTokens: 5000,
    unitAmount: 7900,
  },
  {
    key: "scale",
    productName: "SynthPress Scale",
    description: "For agencies & networks",
    monthlyTokens: 20000,
    unitAmount: 19900,
  },
];

const PACKS = [
  {
    key: "pack_500",
    productName: "500 synth tokens",
    description: "Quick top-up for occasional bursts",
    tokens: 500,
    unitAmount: 1900,
  },
  {
    key: "pack_2000",
    productName: "2,000 synth tokens",
    description: "Best value for the average month",
    tokens: 2000,
    unitAmount: 5900,
  },
  {
    key: "pack_10000",
    productName: "10,000 synth tokens",
    description: "Bulk pack for heavy production months",
    tokens: 10000,
    unitAmount: 24900,
  },
];

function preflight() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error(
      "✖ STRIPE_SECRET_KEY is not set. Did you fill it into apps/web/.env.local?",
    );
    process.exit(1);
  }
  if (key.startsWith("sk_live_") && !ALLOW_LIVE) {
    console.error(
      "✖ Refusing to run against a live key without --live. Pass --live to confirm.",
    );
    process.exit(1);
  }
  if (!key.startsWith("sk_test_") && !key.startsWith("sk_live_")) {
    console.error(
      "✖ STRIPE_SECRET_KEY does not look like a Stripe secret key.",
    );
    process.exit(1);
  }
  const mode = key.startsWith("sk_live_") ? "LIVE" : "test";
  console.log(`Stripe mode: ${mode}\n`);
  return new Stripe(key);
}

/**
 * @param {Stripe} stripe
 * @param {string} metadataKey
 * @param {string} metadataValue
 */
async function findProductByMetadata(stripe, metadataKey, metadataValue) {
  // Use the live list rather than search() because search has indexing lag.
  let starting_after;
  for (let page = 0; page < 5; page += 1) {
    const list = await stripe.products.list({
      active: true,
      limit: 100,
      ...(starting_after ? { starting_after } : {}),
    });
    const hit = list.data.find(
      (p) => p.metadata && p.metadata[metadataKey] === metadataValue,
    );
    if (hit) return hit;
    if (!list.has_more) return null;
    starting_after = list.data[list.data.length - 1]?.id;
    if (!starting_after) return null;
  }
  return null;
}

/**
 * @param {Stripe} stripe
 * @param {string} productId
 * @param {{ unit_amount: number; currency: string; recurring?: { interval: "month" } }} params
 */
async function findActivePrice(stripe, productId, params) {
  const list = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 100,
  });
  return (
    list.data.find((p) => {
      if (p.unit_amount !== params.unit_amount) return false;
      if (p.currency !== params.currency) return false;
      if (params.recurring) {
        return p.recurring?.interval === params.recurring.interval;
      }
      return p.recurring === null || p.type === "one_time";
    }) ?? null
  );
}

/**
 * @param {Stripe} stripe
 */
async function provisionPlans(stripe) {
  /** @type {Record<string, string>} */
  const monthlyOut = {};
  /** @type {Record<string, string>} */
  const annualOut = {};

  console.log("Subscription plans (recurring monthly + annual = monthly x 10)");
  for (const plan of PLANS) {
    let product = await findProductByMetadata(stripe, "plan_key", plan.key);
    let createdProduct = false;
    if (!product) {
      product = await stripe.products.create({
        name: plan.productName,
        description: plan.description,
        metadata: {
          plan_key: plan.key,
          monthly_tokens: String(plan.monthlyTokens),
        },
      });
      createdProduct = true;
    }

    // Monthly price
    const monthlyParams = {
      unit_amount: plan.unitAmount,
      currency: "usd",
      recurring: { interval: /** @type {"month"} */ ("month") },
    };

    let monthlyPrice = await findActivePrice(stripe, product.id, monthlyParams);
    let createdMonthly = false;
    if (!monthlyPrice) {
      monthlyPrice = await stripe.prices.create({
        product: product.id,
        ...monthlyParams,
        metadata: { plan_key: plan.key, interval: "month" },
      });
      createdMonthly = true;
    }

    // Annual price = monthly x 10 (2 months free)
    const annualParams = {
      unit_amount: plan.unitAmount * 10,
      currency: "usd",
      recurring: { interval: /** @type {"year"} */ ("year") },
    };

    let annualPrice = await findActivePrice(stripe, product.id, annualParams);
    let createdAnnual = false;
    if (!annualPrice) {
      annualPrice = await stripe.prices.create({
        product: product.id,
        ...annualParams,
        metadata: { plan_key: plan.key, interval: "year" },
      });
      createdAnnual = true;
    }

    const productStatus = createdProduct ? "created" : "product exists";
    const monthlyStatus = createdMonthly ? "new price" : "exists";
    const annualStatus = createdAnnual ? "new price" : "exists";
    console.log(
      `  ${plan.key.padEnd(8)}  ${productStatus.padEnd(14)}  monthly:${monthlyStatus.padEnd(10)}${monthlyPrice.id}`,
    );
    console.log(
      `  ${"".padEnd(8)}  ${"".padEnd(14)}  annual: ${annualStatus.padEnd(10)}${annualPrice.id}`,
    );

    monthlyOut[plan.key] = monthlyPrice.id;
    annualOut[`${plan.key}_annual`] = annualPrice.id;
  }
  return { ...monthlyOut, ...annualOut };
}

/**
 * @param {Stripe} stripe
 */
async function provisionPacks(stripe) {
  /** @type {Record<string, string>} */
  const out = {};
  console.log("\nToken packs (one-time)");
  for (const pack of PACKS) {
    let product = await findProductByMetadata(stripe, "pack_key", pack.key);
    let createdProduct = false;
    if (!product) {
      product = await stripe.products.create({
        name: pack.productName,
        description: pack.description,
        metadata: {
          pack_key: pack.key,
          tokens: String(pack.tokens),
        },
      });
      createdProduct = true;
    }

    const priceParams = { unit_amount: pack.unitAmount, currency: "usd" };

    let price = await findActivePrice(stripe, product.id, priceParams);
    let createdPrice = false;
    if (!price) {
      price = await stripe.prices.create({
        product: product.id,
        ...priceParams,
        metadata: { pack_key: pack.key },
      });
      createdPrice = true;
    }

    const status = createdProduct
      ? "created"
      : createdPrice
        ? "new price"
        : "exists";
    console.log(`  ${pack.key.padEnd(11)}  ${status.padEnd(10)}  ${price.id}`);
    out[pack.key] = price.id;
  }
  return out;
}

/**
 * @param {Record<string, string>} priceIds
 */
function rewriteSeed(priceIds) {
  const seed = readFileSync(SEED_PATH, "utf8");

  let updated = seed;
  /** @type {string[]} */
  const replaced = [];
  /** @type {string[]} */
  const missing = [];

  for (const [key, priceId] of Object.entries(priceIds)) {
    const placeholder = `price_${key}_placeholder`;
    if (updated.includes(placeholder)) {
      updated = updated.split(placeholder).join(priceId);
      replaced.push(`${key} → ${priceId}`);
    } else if (updated.includes(priceId)) {
      // already filled in (rerun)
      replaced.push(`${key} (already in seed)`);
    } else {
      missing.push(key);
    }
  }

  if (updated !== seed) {
    writeFileSync(SEED_PATH, updated);
  }

  console.log("\nseed.sql updates");
  for (const line of replaced) console.log(`  • ${line}`);
  if (missing.length > 0) {
    console.log("  Could not locate placeholder for:", missing.join(", "));
    console.log("  (You may need to update seed.sql manually for these.)");
  }
}

async function main() {
  const stripe = preflight();
  const planPriceIds = await provisionPlans(stripe);
  const packPriceIds = await provisionPacks(stripe);
  rewriteSeed({ ...planPriceIds, ...packPriceIds });

  console.log("\nDone. Next:");
  console.log("  1. Review the diff: git diff supabase/seed.sql");
  console.log("  2. Reload Supabase: supabase db reset --local");
}

main().catch((err) => {
  console.error("\n✖ Stripe setup failed:");
  console.error(err);
  process.exit(1);
});
