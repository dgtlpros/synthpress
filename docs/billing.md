# Billing runbook

How the SynthPress billing system works, how to set it up locally, and how to keep
Stripe + Supabase in sync as you move between test, staging, and production.

## TL;DR

- **Stripe holds the money.** Stripe `Product`s and `Price`s are the source of
  truth for what we charge.
- **Supabase holds the entitlements.** Tables `plans`, `token_packs`,
  `subscriptions`, `token_balances`, `token_transactions`, and `stripe_customers`
  mirror Stripe state and add the synth-token bookkeeping Stripe doesn't know
  about.
- **Webhooks reconcile the two.** Every state change in Stripe fires
  `/api/webhooks/stripe`, which our [billing-service](../apps/web/src/services/billing-service.ts)
  upserts into Supabase. Idempotent on `stripe_event_id`.
- **Test, staging, and production are three separate Stripe accounts (or modes).**
  You repeat the setup steps for each. There is no shared state between them.

## Architecture

```
                 ┌────────────────┐
   user @ /pricing │                │
        ──────────▶│  Server Action │── createCheckout ──▶  Stripe API
                 │  (billing.ts)  │
                 └───────┬────────┘
                         │  client_secret
                         ▼
                 ┌────────────────┐
                 │ EmbeddedCheckout│  user pays ─────▶ Stripe
                 └────────────────┘                       │
                                                          │ webhook
                                                          ▼
                 ┌────────────────────────────────────────────────┐
                 │ /api/webhooks/stripe                           │
                 │   1. verify signature                          │
                 │   2. handle*(event) in billing-service.ts      │
                 │   3. upsert subscriptions / grant tokens       │
                 │      (idempotent on stripe_event_id)           │
                 └────────────────────────────────────────────────┘
                                        │
                                        ▼
                                  Supabase tables
                                  (plans, subscriptions,
                                  token_balances, token_transactions)
                                        │
                                        ▼
                                /account/billing reads
```

## Domain model

| Stripe                       | Supabase                           | Why both exist                                     |
|------------------------------|------------------------------------|----------------------------------------------------|
| `Customer`                   | `stripe_customers (user_id, stripe_customer_id)` | 1:1 mapping so webhooks can find the user.          |
| `Product` + monthly + annual `Price` | `plans (key, stripe_price_id, stripe_annual_price_id, monthly_tokens, ...)` | We add `monthly_tokens` and the human-readable copy. |
| `Product` + `Price` (one-time) | `token_packs (key, stripe_price_id, tokens, ...)` | Same idea for top-up packs.                         |
| `Subscription`               | `subscriptions`                    | Mirrors status / period / cancel-at-period-end.    |
| `Invoice`                    | (none — we just react to events)   | Drives token grants on `subscription_cycle`.       |
| n/a                          | `token_balances`, `token_transactions` | Stripe doesn't know about synth tokens.            |

Webhook idempotency: every grant we write includes the Stripe `event.id` in
`token_transactions.stripe_event_id`. The unique index makes a duplicate event a
no-op even if Stripe retries.

### Annual vs monthly grants

Each plan has both a monthly and an annual `Price` in Stripe (annual = monthly
× 10, i.e. 2 months free). The webhook handler reads
`subscription.items.data[0].price.recurring.interval` to decide how many tokens
to grant per cycle:

- **Monthly** subscribers get `plan.monthly_tokens` per invoice (every month).
- **Annual** subscribers get `plan.monthly_tokens × 12` once per year, on the
  initial checkout and again on each yearly renewal. They prepaid for a year
  of usage, so they get a year of tokens up front.

Switching between monthly and annual via the portal triggers
`customer.subscription.updated`, which our handler syncs into the
`subscriptions` table. Token-grant fairness on the *switch* itself is handled
by Stripe's proration on the *invoice* side: the next invoice (whether it's a
proration or the next normal cycle) will fire `invoice.payment_succeeded` with
its own `event.id`, and our handler grants tokens for that cycle as usual.

## Local development setup

Tested against Node 20+, pnpm 10+, Supabase CLI, Stripe CLI. Steps assume you
already have the repo cloned and `pnpm install` run.

### 1. Install + log into the Stripe CLI

```bash
brew install stripe/stripe-cli/stripe
stripe login
```

### 2. Drop your Stripe API keys into `apps/web/.env.local`

Get them from [the test-mode dashboard](https://dashboard.stripe.com/test/apikeys):

```bash
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
# STRIPE_WEBHOOK_SECRET will be filled in step 6
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Also confirm `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are
set from `supabase status`.

### 3. Provision Stripe products + prices

```bash
cd apps/web
pnpm stripe:setup
```

This idempotently creates 3 subscription Products (Starter, Pro, Scale) and 3
one-time Token Pack Products (500 / 2,000 / 10,000 tokens), each with a Price
attached, then rewrites [`supabase/seed.sql`](../supabase/seed.sql) with the
real `price_…` IDs in place of the placeholders. Reruns are safe — existing
products are reused.

### 4. Reload the Supabase seed

```bash
cd ../..
supabase db reset --local
```

This wipes the local DB, reapplies migrations, and reruns `seed.sql`, which
inserts the now-populated `plans` and `token_packs` rows. **You must rerun this
whenever `seed.sql` changes** (e.g. after adding a new plan tier).

### 5. Start the dev server

```bash
pnpm dev
```

### 6. Forward Stripe webhooks to localhost

In a second terminal:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Copy the printed `whsec_...` value into `apps/web/.env.local` as
`STRIPE_WEBHOOK_SECRET`, then **restart `pnpm dev`** so Next.js picks up the new
env. The signing secret is stable per machine + Stripe account, so once this is
in `.env.local` you don't need to update it again.

### 7. Configure the Customer Portal (one-time per environment)

Go to https://dashboard.stripe.com/test/settings/billing/portal and turn on:

- **Customers can switch plans** — add **all six prices** as eligible:
  Starter monthly + annual, Pro monthly + annual, Scale monthly + annual. This
  is what lets users switch monthly ↔ annual via the portal in addition to
  Starter ↔ Pro ↔ Scale.
- **Proration: Prorate** — charge the difference immediately on upgrade,
  credit on downgrade. Most SaaS apps want this.
- **Cancellations** — keep on.
- **Invoice history** (optional) — lets users download past invoices.

This is what makes "Manage subscription" show **Update plan** alongside
**Cancel subscription**.

> When you add a brand new plan or interval (e.g. quarterly), don't forget to
> come back here and add it to the eligible-products list. Otherwise the
> portal will hide it from upgrade flows.

### 8. Configure Stripe automated emails (one-time per environment)

These are receipts, failed-payment retries, and renewal reminders that Stripe
sends on your behalf. No code — purely dashboard toggles:

- https://dashboard.stripe.com/test/settings/emails — under **Customer
  emails**, enable:
  - **Successful payments** (sends a receipt after each charge).
  - **Refunds** (sends a notification when you refund a charge).
- https://dashboard.stripe.com/test/settings/billing/automatic — under
  **Subscriptions and emails**, enable:
  - **Email customers about failed payments** (the dunning sequence).
  - **Email customers about expiring cards** (proactive churn prevention).
  - **Email customers about renewing subscriptions** (heads-up before renewal).
- Brand the emails: https://dashboard.stripe.com/settings/branding — set the
  business name, logo, and accent color so the emails match SynthPress.

Repeat this in **live mode** before launching publicly:
- https://dashboard.stripe.com/settings/emails (no `/test/`)
- https://dashboard.stripe.com/settings/billing/automatic (no `/test/`)

You don't need any custom email infrastructure (Resend, Postmark, etc.) for
billing — Stripe covers receipts, retries, and renewal heads-ups out of the
box. Add an email service later if you need non-billing transactional emails
(welcome, low-balance warnings, etc.).

### 9. Stripe Tax (deferred — opt in when you have tax nexus)

We do **not** pass `automatic_tax: { enabled: true }` on checkout sessions by
default. The reason: enabling automatic tax forces Stripe to collect a full
billing address (country, line 1, city, state, postal) at checkout, and then
the Customer Portal also asks for the full address whenever the user touches
the subscription. Until you actually have nexus somewhere and want to charge
tax, that's friction with no payoff — Stripe Tax would just compute $0.

When you're ready (typically: revenue threshold reached in some jurisdiction):

1. https://dashboard.stripe.com/test/settings/tax — turn Stripe Tax on.
2. Add the jurisdictions you have tax nexus in (Stripe walks you through it).
3. Set your default product tax category (most SaaS = "Software as a service").
4. In [stripe-service.ts](../apps/web/src/services/stripe-service.ts), add to
   both `createSubscriptionCheckoutSession` and `createTopUpCheckoutSession`:
   ```ts
   automatic_tax: { enabled: true },
   customer_update: { address: "auto", name: "auto" },
   ```
5. Update the corresponding tests in
   [stripe-service.test.ts](../apps/web/src/services/stripe-service.test.ts).

Existing subscriptions retain whichever setting they were created with — turning
tax on later applies to *new* subscriptions; old ones stay tax-free until the
customer's next plan change.

### 10. Smoke test

1. Sign up at http://localhost:3000/signup with a fresh email; verify the
   magic link in [Mailpit](http://127.0.0.1:54324).
2. Dashboard header should show **100 tokens** (welcome bonus from
   `handle_new_user` in
   [`00002_billing.sql`](../supabase/migrations/00002_billing.sql)).
3. http://localhost:3000/pricing → click **Subscribe** on Pro → use test card
   `4242 4242 4242 4242` with any future expiry + any CVC.
4. The `stripe listen` terminal should show:
   - `checkout.session.completed [200]`
   - `customer.subscription.created [200]`
   - `invoice.payment_succeeded [200]`
5. http://localhost:3000/account/billing should show **Pro** plan and **5,100
   tokens** (100 + 5,000).
6. Click **Buy now** on a top-up pack → balance jumps by the pack size.

## Going to production

Stripe **test mode** and **live mode** are completely separate stores of data.
Same for the Supabase `local` project vs. your production project. You repeat the
setup against live for go-live.

### Production deploy checklist

1. **Push migrations to the production Supabase project.**
   ```bash
   supabase link --project-ref <prod-project-ref>
   supabase db push                       # applies anything in supabase/migrations
   ```
   Migrations are append-only; never edit `00001_*` or `00002_*` after they've
   shipped — instead add `00003_…sql` etc.

2. **Provision Stripe products in live mode.**

   Point `STRIPE_SECRET_KEY` at your live secret key for one terminal session
   (don't commit it):
   ```bash
   export STRIPE_SECRET_KEY=sk_live_…
   pnpm stripe:setup --live
   ```
   The `--live` flag is required to opt in; without it the script refuses to
   run against a `sk_live_…` key. The script idempotently creates the live
   Products + Prices (monthly + annual + token packs) and rewrites
   [`supabase/seed.sql`](../supabase/seed.sql) with the **live** `price_…` IDs.

3. **Apply the catalog seed to the prod Supabase project.**

   `supabase db push` runs migrations only — it does **not** run `seed.sql`.
   So you have to apply the catalog data to prod yourself. The seed's
   `INSERT … ON CONFLICT DO UPDATE` statements are idempotent, so this is
   safe to redo anytime you tweak a plan:

   1. Open the prod Supabase Studio SQL editor:
      `https://supabase.com/dashboard/project/<your-ref>/sql/new`
   2. Copy the entire contents of [`supabase/seed.sql`](../supabase/seed.sql)
      (it now has live `price_…` IDs from step 2) and paste into the editor.
   3. Click **Run**. You should see "Success. No rows returned." — under the
      hood it just upserted 3 plans + 3 token packs.

   Alternative: run from your terminal with `psql`:
   ```bash
   # Get the connection string from Supabase Studio → Project Settings → Database → Connection string → URI
   psql "postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" \
     -f supabase/seed.sql
   ```

   When you're done, **don't commit the live IDs** to git. Restore the
   test-mode IDs so dev keeps working:
   ```bash
   git checkout supabase/seed.sql
   unset STRIPE_SECRET_KEY                       # drops the live key from your shell
   pnpm stripe:setup                             # rewrites seed.sql with test IDs
   ```

   > Why no migration for catalog data? It's tempting to write a
   > `00004_seed_billing_catalog.sql` migration with the live IDs and let
   > `supabase db push` apply it automatically. The trade-off: that migration
   > is unusable for local dev (it has live IDs), and committing live IDs to
   > git is poor hygiene. Keeping the catalog seed out of migrations and
   > applying it manually per environment keeps dev/prod symmetric and the
   > git history clean. Future enhancement: a `pnpm catalog:sync` script that
   > talks directly to Stripe + Supabase and removes the manual paste step.

4. **Add the production webhook endpoint in Stripe live mode.**
   - Dashboard → Developers → Webhooks → **+ Add endpoint**.
   - URL: `https://<your-domain>/api/webhooks/stripe`.
   - Events to send (or "Receive all events"):
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
     - `charge.refunded` — required for token revocation on refunds.
     - `charge.dispute.closed` — required for token revocation on lost
       chargebacks. (Optionally also `charge.dispute.created` if you want a
       record of opened disputes; we don't act on it but Stripe will deliver
       it for observability.)
   - Copy the `whsec_…` it generates — this is the *production* signing secret,
     different from your local one.

5. **Set production env vars on your hosting platform** (Vercel, etc.):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<prod publishable key>
   SUPABASE_SERVICE_ROLE_KEY=<prod service role secret>
   STRIPE_SECRET_KEY=sk_live_...
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_<from prod webhook endpoint>
   NEXT_PUBLIC_APP_URL=https://<your-domain>
   ```

6. **Configure the live Customer Portal** at
   https://dashboard.stripe.com/settings/billing/portal (no `/test/`) — same
   options as step 7 of the local setup.

7. **Verify with a real card** (or a Stripe test clock for subscription
   renewal). Stripe test cards do not work in live mode; use a real card and
   refund yourself, or use [test clocks](https://docs.stripe.com/billing/testing/test-clocks).

### Staging environment

If you have a staging environment, treat it like a third copy: a separate
Supabase project, separate Stripe test-mode account (or just reuse test mode if
you don't mind sharing), separate webhook endpoint with its own `whsec_…`.

## Edge cases & failure modes

How the system behaves when things don't go on the happy path. The goal of
this section is that the user always knows exactly what's going on with their
plan and their tokens.

### Cancellation

When a user cancels through the Customer Portal, Stripe sets
`cancel_at_period_end = true` and keeps the subscription `active` until the
paid period ends. Our handler mirrors that into the `subscriptions` table
verbatim. The user keeps full access **and** keeps every token they were
granted from the most recent paid cycle (tokens roll over forever — we never
revoke a paid grant).

What the user sees on `/account/billing`:

- A **warning banner** at the top: *"Pro is set to cancel on June 5, 2026"*
  with a primary **Resume subscription** button.
- Inside the subscription card, the plan badge switches from `Pro` to
  `Pro · Canceling` (warning variant) and the footnote reads
  *"Subscription ends on June 5, 2026."*
- The action row offers both **Resume subscription** and **Manage subscription**.
- A new row in **Recent activity**: *"Subscription canceled — Subscription
  scheduled to end on June 5, 2026"* (0 tokens, paper-trail only).

After the period ends, Stripe sends `customer.subscription.deleted`, our
handler syncs `status: 'canceled'`, `getActiveSubscription` filters them out,
and the page falls back to the free state with a **Choose a plan** CTA. The
user's leftover tokens stay in their balance — they can keep using them.

If the user clicks **Resume subscription** before the period ends, the
banner clears and a *"Subscription resumed"* row appears in the activity
feed. Plan downgrades through the portal also emit a *"Plan downgraded"*
audit row so the timeline is complete; upgrades already surface via the
matching `subscription_grant` row from the proration invoice.

These three lifecycle events (`subscription_canceled`, `subscription_resumed`,
`plan_downgraded`) are 0-amount entries in `token_transactions`, written
by `recordSubscriptionEvent` from
[`token-service.ts`](../apps/web/src/services/token-service.ts). They're
idempotent on a per-transition suffix of the Stripe event id (e.g.
`evt_xxx::canceled`), so a single Stripe event can fire multiple
transitions and replays never duplicate.

### Failed payment on renewal

When `invoice.payment_failed` fires, our handler updates the subscription's
status to `past_due`. **No tokens are granted** for that cycle (the only token
grant on renewal is in `handleInvoicePaymentSucceeded`, which fires after
payment lands).

What the user sees:

- A **danger banner** at the top: *"Your last payment failed"* with a primary
  **Update payment method** button that opens the Customer Portal.
- The plan badge changes to `Pro · Past due` (warning variant).
- Stripe automatically retries failed payments (smart retries — configurable
  in https://dashboard.stripe.com/settings/billing/automatic). When a retry
  succeeds the next `invoice.payment_succeeded` event grants tokens for that
  cycle as usual.
- If all retries fail, Stripe eventually moves the subscription to `unpaid`
  or `canceled` based on dunning settings. Either way the banner stays
  prominent until the user resolves it.

### Refunds (you issue a refund through Stripe)

Stripe fires `charge.refunded`. Our handler:

1. Looks up the user via `stripe_customers` using the charge's customer id.
2. Sums the original token grants tied to the charge by reading
   `token_transactions.metadata->>stripe_invoice_id` (subscription cycle) or
   `metadata->>stripe_payment_intent_id` (top-up purchase).
3. Calculates `tokens_to_revoke = ceil(total_granted * (amount_refunded / amount))`.
   A full refund revokes everything; a partial refund revokes the same
   fraction.
4. Calls `recordTokenRefund`, which writes a negative `token_transactions` row
   of type `refund` (idempotent on `stripe_event_id`) and decrements the
   balance. **Clamped at zero** — if the user has already spent the tokens,
   we record the audit row with `deducted_amount: 0` so we still know it
   happened, but the balance never goes negative.

### Chargebacks (the customer disputes a charge with their bank)

Two events are involved:

- `charge.dispute.created` — opened. We don't act yet; the dispute could be
  won. Submit evidence in the Stripe Dashboard.
- `charge.dispute.closed` — resolved. Our handler revokes tokens **only** when
  `dispute.status === 'lost'`. If the dispute is won, no action; the user
  keeps their access and tokens.

The chargeback revocation uses the same lookup + clamp-at-zero path as
refunds, so it's safe to replay and never produces a negative balance.

### Plan switching mid-cycle (upgrade or downgrade)

Stripe handles the proration on the money side: an upgrade charges the
difference for the rest of the period; a downgrade credits the difference.
We track this in two webhooks:

1. `customer.subscription.updated` → `handleSubscriptionUpdated` syncs the
   new `plan_key` / `stripe_price_id` / period bounds into the
   `subscriptions` table. The `plan_key` is derived from the **current**
   price id, never from `subscription.metadata.plan_key` (which Stripe
   doesn't update on dashboard / portal switches).
2. `invoice.payment_succeeded` with `billing_reason: 'subscription_update'`
   → `handleInvoicePaymentSucceeded` computes the token delta:

   - **Upgrade** (new tier > previous tier): grant the difference. E.g. Pro
     → Scale grants `20,000 − 5,000 = 15,000` extra tokens immediately. The
     audit row's metadata records `grant_kind: 'upgrade_proration'`,
     `previous_plan_key`, `previous_cycle_tokens`, `new_cycle_tokens`.
   - **Downgrade or same-tier**: skip the grant. Per the rollover model the
     user keeps every token they already received; we never deduct on a
     plan change. The next renewal cycle naturally grants the new tier.
   - Cadence flips (monthly ↔ annual) are handled the same way because
     `tokensForCycle()` returns `monthly × 12` for annual subscriptions.

The upgrade grant is idempotent on `event.id` like every other grant, so
replays are safe.

### Stripe API field migrations to be aware of

Stripe API version `2024-11-20.acacia` and later quietly moved a few fields
that our handlers used to read directly. Each is a "webhook returns 200 but
nothing happens" class of bug. Fixed here so the codebase reads both the
new and legacy shapes:

- **`invoice.subscription`** → `invoice.parent.subscription_details.subscription`.
  Read by [`extractSubscriptionIdFromInvoice`](../apps/web/src/services/billing-service.ts).
  Affects every `invoice.payment_succeeded` and `invoice.payment_failed`
  handler.
- **`subscription.cancel_at_period_end`** (boolean) → `subscription.cancel_at`
  (timestamp). The Customer Portal in modern API leaves the boolean at
  `false` and sets `cancel_at` to the period-end timestamp instead. Read by
  [`isScheduledToCancel`](../apps/web/src/services/billing-service.ts).
  Affects whether the billing page shows "Subscription ends on …" + the
  Resume button.

If you ever upgrade the SDK and notice a webhook handler returns 200 but
the user-facing state isn't changing, **check these two helpers first**.

### Initial payment incomplete

If the very first checkout payment doesn't land (e.g. SCA challenge
abandoned), the subscription is created with `status: 'incomplete'` and
Stripe gives the customer ~24h to finish. Our handler still mirrors it.

What the user sees:

- A **warning banner**: *"Subscription is pending payment"* with a
  **Manage subscription** button.
- The plan badge reads `Pro · Incomplete`.

If the customer completes payment, the subscription becomes `active` and the
normal grant path runs. If they don't, Stripe transitions it to
`incomplete_expired` and we mirror that.

### Webhook ordering

Stripe doesn't guarantee event ordering. We rely on three things:

1. **Idempotency** on every grant via `token_transactions.stripe_event_id`
   (unique index). Replays don't double-credit.
2. **Upsert by primary key** in `subscriptions` so the latest event wins per
   subscription, regardless of order.
3. **Re-fetching from Stripe** in renewal/dispute handlers (`retrieveSubscription`,
   `retrieveCharge`) — we don't trust the event payload alone, we always work
   from Stripe's current view.

In rare out-of-order races (e.g. `subscription.deleted` arriving before
`subscription.updated`), the upsert means the field-by-field state can churn
briefly. This hasn't been a real issue in practice, but it's worth noting
that "the most recent event wins" is the policy.

### Out of tokens during AI usage

`consume_tokens` is a Postgres function. It atomically deducts and raises
`insufficient_tokens` (Postgres error code `P0001`) when the balance is too
low. Surface the error at the call site:

- Convert `insufficient_tokens` into a friendly UI prompt suggesting a
  top-up or subscription upgrade.
- Log the failure for observability (it's not a system error — it's a
  user-state error).

### Manual token adjustments

To grant or revoke tokens outside of Stripe (e.g. customer-support credit,
goodwill refund without a real Stripe refund), insert a row into
`token_transactions` with type `adjustment`, a positive or negative `amount`,
and a `description`. The balance is recomputed automatically because all
queries derive from the transaction log.

### Replaying a refund or dispute event

```bash
stripe events resend evt_<id>
```

Like every other handler, refund + dispute handlers are idempotent on
`stripe_event_id`. A duplicate replay is a no-op, so it's always safe.

## Database hardening & performance

The schema and policies are tuned for both correctness under concurrent
webhook delivery and reasonable performance as the audit log grows.

### Atomic token operations

All balance-changing writes go through Postgres functions, never through
read-then-upsert in TypeScript. Three reasons:

- **No race conditions.** Two webhook events for the same user (e.g.
  `invoice.payment_succeeded` + `charge.refunded` arriving simultaneously)
  serialize on the row lock inside the function. With separate JS read +
  upsert calls, both could read the same balance and one event's effect
  would be lost.
- **Idempotency in one place.** Each function checks
  `token_transactions.stripe_event_id` first, then catches `unique_violation`
  on the insert as the real safety net. Replays always short-circuit.
- **Audit trail and balance always agree.** They're written in the same
  transaction, so the transaction log can never get out of sync with the
  balance.

The functions:

| RPC | Purpose | Returns |
|-----|---------|---------|
| `consume_tokens(p_user_id, p_amount, p_description)` | Atomic deduction for AI usage; throws `insufficient_tokens` (errcode P0001) when balance is too low. | `int` (new balance) |
| `grant_tokens(p_user_id, p_amount, p_type, p_description?, p_stripe_event_id?, p_metadata?)` | Atomic positive grant (signup, subscription, top-up, manual adjustment). | `int` (new balance) or `null` if event was already processed |
| `record_token_refund(p_user_id, p_amount, p_stripe_event_id?, p_description?, p_metadata?)` | Atomic clamped-at-zero refund/chargeback revocation. Always writes the audit row even when nothing is left to deduct. | `jsonb` `{ requested, deducted, balance }` or `null` if event was already processed |

All three are `security definer` functions with `search_path = ''`,
revoked from `public` and granted only to `service_role` (or `authenticated`
in the case of `consume_tokens`, which the AI feature will call).

The TypeScript wrappers in
[`apps/web/src/services/token-service.ts`](../apps/web/src/services/token-service.ts)
are thin one-liners that just forward to the RPC and unwrap the result.

### RLS policy performance

Every `auth.uid() = user_id` policy is wrapped as `(select auth.uid()) =
user_id`. Postgres treats `auth.uid()` as `VOLATILE` which forces a
per-row call; wrapping it in a scalar subquery makes Postgres evaluate it
once per query plan. This is the documented Supabase performance pattern
and matters most on `token_transactions` and `articles` as they grow.

### Explicit deny policies on billing tables

`stripe_customers`, `subscriptions`, `token_balances`, and
`token_transactions` carry an explicit
`for all to authenticated, anon using (false) with check (false)` policy.
The service-role client (used by webhooks and server actions) bypasses RLS
entirely so this doesn't affect legitimate writes — it's belt-and-suspenders
that surfaces in security scans and makes intent unambiguous: clients
cannot mutate billing state, period.

### Indexes

| Index | Columns | Why |
|-------|---------|------|
| `subscriptions_user_id_status_idx` | `(user_id, status)` | Composite supports both `getActiveSubscription` (filters on both) and any user-scoped query (uses leading column). |
| `token_transactions_user_id_created_at_idx` | `(user_id, created_at desc)` | Powers the recent-activity feed on `/account/billing`. |
| `token_transactions_invoice_idx` | `(metadata->>'stripe_invoice_id')` partial `where amount > 0` | Refund handler looks up the original subscription grant by invoice id. Partial keeps the index tiny — only positive grants. |
| `token_transactions_payment_intent_idx` | `(metadata->>'stripe_payment_intent_id')` partial `where amount > 0` | Same idea for top-up purchases (linked via PaymentIntent rather than Invoice). |
| `stripe_customers.stripe_customer_id` (unique) | — | Webhook lookup user-from-customer in `findUserIdForStripeCustomer`. |
| `subscriptions.stripe_subscription_id` (unique) | — | Upsert-on-conflict for subscription sync. |
| `token_transactions.stripe_event_id` (unique) | — | Idempotency for every webhook-driven write. |

### When to add a new RPC

Add a Postgres function (RPC) when you need:

- **Atomicity** across multiple writes that the client can't safely retry
  (balance + audit row, like above).
- **Conditional writes** like "decrement only if balance ≥ amount" (the
  `consume_tokens` shape).
- **Aggregation** that's expensive over the wire (e.g. dashboard counters).

Don't reach for an RPC when a single Supabase query covers it — the
overhead of an extra abstraction layer isn't worth it for simple
read/insert/update calls.

## Common operations

### Add a new subscription plan

1. Add a row to the `PLANS` array in
   [`apps/web/scripts/stripe-setup.mjs`](../apps/web/scripts/stripe-setup.mjs).
2. Add the matching `INSERT` in [`supabase/seed.sql`](../supabase/seed.sql)
   (or in a new migration for prod) with `stripe_price_id` set to a placeholder.
3. Run `pnpm stripe:setup` (test) or `pnpm stripe:setup --live` (prod). The
   script will create the new product + price and rewrite the seed.
4. `supabase db reset --local` to pick up the new row.

### Change a plan's price or token allowance

You **don't** edit Stripe `Price`s in place — they're immutable. The pattern is:
create a new Price, archive the old one, then keep both in your DB so existing
subscribers stay on the old price until they switch. Easiest path:

1. Manually create the new Price in Stripe dashboard or via the CLI.
2. Update the `stripe_price_id` in `seed.sql` to the new Price.
3. Existing subscribers keep their old Price (Stripe doesn't auto-migrate them).
   If you want to migrate them, use the Stripe API to update each subscription.

### Resume a subscription scheduled for cancellation

When a user cancels through the Customer Portal, Stripe sets
`cancel_at_period_end = true`. The subscription stays active until the period
ends. Two ways to undo it:

1. **In-app**: `/account/billing` shows a primary "Resume subscription" button
   alongside the secondary "Manage subscription" button when
   `cancel_at_period_end` is true. The button calls the
   [`resumeSubscription` server action](../apps/web/src/actions/billing.ts),
   which calls `stripe.subscriptions.update(id, { cancel_at_period_end: false })`
   and revalidates the page.
2. **Customer Portal**: clicking "Manage subscription" still works — Stripe's
   portal exposes a "Renew subscription" link for the same effect.

Both produce a `customer.subscription.updated` webhook that our handler syncs
into the `subscriptions` table.

### Replay a failed webhook event

```bash
stripe events resend evt_<id>
```

Idempotency means it's safe to replay anything — events that already succeeded
will short-circuit thanks to `token_transactions.stripe_event_id` and the upsert
in `subscriptions`.

### Trigger fake events (for handler development)

```bash
stripe trigger checkout.session.completed
stripe trigger invoice.payment_succeeded
stripe trigger customer.subscription.deleted
```

These create real test data in your Stripe test mode and fire your local
webhook handler.

## Billing history page

`/account/billing/invoices` shows the user's last 12 Stripe invoices with
PDF download + hosted-view links. Two design notes:

- **Live fetch, not mirrored.** The page calls `stripe.invoices.list({ customer })`
  via [`getCustomerInvoices`](../apps/web/src/services/stripe-service.ts) on
  every render (the page is `force-dynamic`). We don't keep an `invoices`
  table because Stripe is already the source of truth, the data is read-only
  for the user, and a webhook-mirrored cache would just be one more thing
  that can drift. Every charge generates a hosted PDF on Stripe's CDN —
  `invoice.invoice_pdf` is a direct download URL we link to with the
  `download` attribute.
- **Streamed via Suspense.** The page header renders immediately; the list
  is wrapped in `<Suspense fallback={<InvoiceListSkeleton />}>`. Next.js
  streams the resolved list into the same response once Stripe responds, so
  the user sees a coherent shell within ~30ms even if Stripe takes 200ms.

If a user needs older invoices than the last 12, the footer points them at
the Customer Portal (which Stripe paginates fully).

We never render PDFs ourselves. If you ever need a custom-branded PDF, the
right path is enabling Stripe's invoice branding (logo + accent color) at
https://dashboard.stripe.com/settings/branding — it applies to every
existing and future PDF without code changes.

## Teams and the billing subject

> Added in migrations [00009](../supabase/migrations/00009_token_transactions_idempotency.sql) – [00013](../supabase/migrations/00013_team_invites.sql).

Teams sit on top of the per-user billing system without changing any of the
Stripe wiring. A team has exactly one **owner**, the owner's `auth.users.id`
is the **billing subject**, and any team-context spend (today: future blog
automations, AI generation jobs, etc.) atomically debits the owner's
`token_balances` row even when a different member triggered the work.

### The billing subject column

`teams.billing_user_id` (NOT NULL) is the canonical pointer to the team's
billing subject. It's maintained by a Postgres trigger
(`keep_team_billing_user_id_in_sync()` in
[00010](../supabase/migrations/00010_team_billing_subject.sql)) that fires
on every `team_members` insert / update / delete, resolves the row where
`role = 'owner'`, and writes that user_id back to `teams.billing_user_id`.

A partial unique index (`teams_one_owner_idx`) makes "exactly one owner per
team" a hard DB invariant — you cannot insert a second owner row even
under the service-role client.

### `consume_team_tokens` RPC

`consume_team_tokens(p_team_id, p_amount, p_acting_user_id, p_description,
p_metadata, p_idempotency_key)` is the team-scoped equivalent of
`consume_tokens`. Defined in
[00012](../supabase/migrations/00012_consume_team_tokens.sql). In one
transaction it:

1. Resolves the owner via `teams.billing_user_id`.
2. Decrements the owner's `token_balances.balance` (raises
   `insufficient_tokens` if the balance is too low).
3. Inserts a `token_transactions` row with `type='usage'`,
   `user_id = owner`, and `metadata = caller_metadata || {team_id,
   acting_user_id}` so the owner's ledger shows exactly what spent the
   tokens and on whose behalf.

The RPC is service-role only. Server actions create the admin client and
call it through
[`team-billing-service.consumeTeamTokens`](../apps/web/src/services/team-billing-service.ts).

#### Metadata contract

Every team-spend `token_transactions` row always has at minimum:

| Key              | Source                          | Notes                                                |
|------------------|---------------------------------|------------------------------------------------------|
| `team_id`        | RPC injects                     | Used by the per-team usage view's partial index.     |
| `acting_user_id` | RPC injects                     | The member who triggered the job (≠ owner if member-triggered). |
| `project_id`     | Caller (optional)               | Recommended — drives "by project" rollup on usage.   |
| `blog_id`        | Caller (optional)               | Recommended — same.                                  |
| `automation_id`  | Caller (optional, future)       | When automation runner lands.                        |

The RPC merges `caller_metadata || jsonb_build_object('team_id', ..., 'acting_user_id', ...)`
so the system fields always win.

#### Idempotency

`p_idempotency_key` is the internal-job equivalent of `stripe_event_id`. Use
it for any consume that may be retried (cron jobs, webhook-driven jobs).
The unique partial index `token_transactions_idempotency_key_idx` (added in
[00009](../supabase/migrations/00009_token_transactions_idempotency.sql))
makes a duplicate key a no-op. The RPC short-circuits via a fast-path
EXISTS check; on a concurrent race the unique-violation handler re-credits
the debit and returns the current balance.

We deliberately did **not** overload `stripe_event_id` for internal jobs —
that column remains the lock for Stripe webhooks alone (see
[supabase-database rule](../.cursor/rules/supabase-database.mdc)).

#### Per-team usage queries

The team usage page (`/teams/[teamId]/usage`) filters
`token_transactions` by `metadata->>'team_id' = $1 AND type = 'usage'` and
joins to `projects`, `blogs`, `profiles` in batched id-set queries via
[`team-usage-service.getTeamUsage`](../apps/web/src/services/team-usage-service.ts).
The partial expression index `token_transactions_team_usage_idx` makes the
filter O(log n) regardless of audit-log size.

### Roles and permissions

| Role     | Permissions                                                                                  |
|----------|----------------------------------------------------------------------------------------------|
| `owner`  | Everything. Sole subscription holder. Sees the full per-team usage ledger.                   |
| `admin`  | Invite/remove members, manage projects, run jobs (spends owner's tokens), view usage rollups.|
| `member` | Edit content, run jobs (spends owner's tokens). Cannot invite/remove or see usage page.      |

The mapping lives in
[`team-policy-service.ts`](../apps/web/src/services/team-policy-service.ts)
as a single `PERMISSIONS` table; server actions call `assertCan(teamId,
userId, action)` to gate every mutation. The matching DB helper
`user_team_role(team_id, user_id)` is in
[00011](../supabase/migrations/00011_team_role_helpers.sql) and is also
available to RLS policies if we ever need role-aware row scoping.

### Invites (shareable link, v1)

`team_invites` ([00013](../supabase/migrations/00013_team_invites.sql))
holds one-time invitations. The raw token is **only** returned by
`createInvite` — we store SHA-256 of it (`token_hash`) and compare hashes
on accept, mirroring how Supabase Auth handles its own magic-link tokens.

- `email IS NULL` ⇒ open link, anyone signed in can accept once.
- `email IS NOT NULL` ⇒ only the auth user with that email may accept; a
  partial unique index prevents duplicate pending invites for the same
  (team, email).
- `expires_at` defaults to `now() + 14 days`.
- All mutations go through the service-role client; clients have a
  read-only RLS policy plus an explicit deny.

The accept flow lives at `/teams/invite/[token]`. v1 is **shareable link
only** — owners/admins copy the link from the team settings page and paste
it into Slack/email/wherever. There is no transactional email yet (see
Phase 5+ below).

### Header billing context

`/(dashboard)/layout.tsx` pre-fetches every team's billing context (owner,
plan, balance) and passes it to
[`HeaderTokenContextConnector`](../apps/web/src/connectors/HeaderTokenContextConnector.tsx).
The connector reads `usePathname` and swaps the header `TokenBadge`:

- Outside team routes → user's personal balance + "View billing" link.
- Inside `/teams/[teamId]/...` → the team owner's balance + "Spending
  {team} balance (paid by {owner})" tooltip + link to `/teams/[teamId]/usage`
  (or `/account/billing` when the user is themselves the owner).

### Phase 5+ roadmap (deferred from v1)

| Item                                  | Why deferred                                                                                                     |
|---------------------------------------|------------------------------------------------------------------------------------------------------------------|
| **Ownership transfer**                | Requires a policy decision on the existing Stripe subscription (move it, leave it on the old owner, or block transfer while paid).  Skipped per the v1 user request. |
| **Transactional email for invites**   | Add Resend (or Postmark/SES) — a single API key + template — so we send a real invite email instead of just returning a copyable link. |
| **Team-level Stripe subscriptions**   | `billing_user_id` already abstracts the subject; moving Stripe customers/subscriptions to live on `team_id` is a one-migration future task. |
| **Per-role RLS on content tables**    | Today RLS treats any team member equally for content reads/writes; role gating happens in the service layer. Tightening RLS is a Phase 5 hardening step. |
| **`next` param round-trip on login**  | Currently the `/teams/invite/[token]` route bounces unauthenticated visitors to `/login`; they must re-open the invite link after signing in. The full `?next=` flow needs the magic-link template to thread the param through. |

## Where things live in the codebase

| Concern                            | File                                                                       |
|------------------------------------|----------------------------------------------------------------------------|
| Initial schema                     | [supabase/migrations/00002_billing.sql](../supabase/migrations/00002_billing.sql) |
| Annual billing columns             | [supabase/migrations/00003_annual_billing.sql](../supabase/migrations/00003_annual_billing.sql) |
| Atomic grant/refund RPCs           | [supabase/migrations/00004_atomic_token_grants.sql](../supabase/migrations/00004_atomic_token_grants.sql) |
| RLS perf + deny policies + indexes | [supabase/migrations/00005_rls_and_indexes.sql](../supabase/migrations/00005_rls_and_indexes.sql) |
| Internal idempotency_key column    | [supabase/migrations/00009_token_transactions_idempotency.sql](../supabase/migrations/00009_token_transactions_idempotency.sql) |
| Team billing subject + trigger     | [supabase/migrations/00010_team_billing_subject.sql](../supabase/migrations/00010_team_billing_subject.sql) |
| user_team_role helper              | [supabase/migrations/00011_team_role_helpers.sql](../supabase/migrations/00011_team_role_helpers.sql) |
| consume_team_tokens RPC + index    | [supabase/migrations/00012_consume_team_tokens.sql](../supabase/migrations/00012_consume_team_tokens.sql) |
| Team invites table + RLS           | [supabase/migrations/00013_team_invites.sql](../supabase/migrations/00013_team_invites.sql) |
| Team-spend service                 | [apps/web/src/services/team-billing-service.ts](../apps/web/src/services/team-billing-service.ts) |
| Team policy / role table           | [apps/web/src/services/team-policy-service.ts](../apps/web/src/services/team-policy-service.ts) |
| Team invite service                | [apps/web/src/services/team-invite-service.ts](../apps/web/src/services/team-invite-service.ts) |
| Per-team usage rollups             | [apps/web/src/services/team-usage-service.ts](../apps/web/src/services/team-usage-service.ts) |
| Server actions (team billing)      | [apps/web/src/actions/team-billing.ts](../apps/web/src/actions/team-billing.ts) |
| Server actions (team invites)      | [apps/web/src/actions/team-invites.ts](../apps/web/src/actions/team-invites.ts) |
| Server actions (team members)      | [apps/web/src/actions/team-members.ts](../apps/web/src/actions/team-members.ts) |
| Team settings page                 | [apps/web/src/app/(dashboard)/teams/[teamId]/settings/page.tsx](<../apps/web/src/app/(dashboard)/teams/[teamId]/settings/page.tsx>) |
| Team usage page                    | [apps/web/src/app/(dashboard)/teams/[teamId]/usage/page.tsx](<../apps/web/src/app/(dashboard)/teams/[teamId]/usage/page.tsx>) |
| Invite accept page                 | [apps/web/src/app/(dashboard)/teams/invite/[token]/page.tsx](<../apps/web/src/app/(dashboard)/teams/invite/[token]/page.tsx>) |
| Header token context (team-aware)  | [apps/web/src/connectors/HeaderTokenContextConnector.tsx](../apps/web/src/connectors/HeaderTokenContextConnector.tsx) |
| Catalog seed                       | [supabase/seed.sql](../supabase/seed.sql)                                  |
| Setup script (Stripe + seed)       | [apps/web/scripts/stripe-setup.mjs](../apps/web/scripts/stripe-setup.mjs)  |
| Stripe SDK + Checkout/Portal helpers | [apps/web/src/services/stripe-service.ts](../apps/web/src/services/stripe-service.ts) |
| Webhook handlers + sync logic      | [apps/web/src/services/billing-service.ts](../apps/web/src/services/billing-service.ts) |
| Token bookkeeping                  | [apps/web/src/services/token-service.ts](../apps/web/src/services/token-service.ts) |
| Server actions (billing)           | [apps/web/src/actions/billing.ts](../apps/web/src/actions/billing.ts) — `createSubscriptionCheckout`, `createTopUpCheckout`, `createBillingPortal`, `resumeSubscription` |
| Server actions (tokens)            | [apps/web/src/actions/tokens.ts](../apps/web/src/actions/tokens.ts)        |
| Webhook route                      | [apps/web/src/app/api/webhooks/stripe/route.ts](../apps/web/src/app/api/webhooks/stripe/route.ts) |
| Stripe browser singleton           | [apps/web/src/lib/stripe-browser.ts](../apps/web/src/lib/stripe-browser.ts) |
| Embedded Checkout drop-in          | [apps/web/src/components/organisms/CheckoutEmbed/](../apps/web/src/components/organisms/CheckoutEmbed/) |
| Billing dashboard organism         | [apps/web/src/components/organisms/BillingSection/](../apps/web/src/components/organisms/BillingSection/) |
| Pricing table (with annual toggle) | [apps/web/src/connectors/PricingTableConnector.tsx](../apps/web/src/connectors/PricingTableConnector.tsx) |
| Billing actions (manage / resume)  | [apps/web/src/connectors/BillingActionsConnector.tsx](../apps/web/src/connectors/BillingActionsConnector.tsx) + [useBillingActions](../apps/web/src/hooks/useBillingActions.ts) |
| Embedded checkout connector + hook | [apps/web/src/connectors/CheckoutConnector.tsx](../apps/web/src/connectors/CheckoutConnector.tsx) + [useCheckout](../apps/web/src/hooks/useCheckout.ts) |
| Pricing page (public)              | [apps/web/src/app/pricing/page.tsx](../apps/web/src/app/pricing/page.tsx)  |
| Checkout page                      | [apps/web/src/app/(dashboard)/checkout/page.tsx](<../apps/web/src/app/(dashboard)/checkout/page.tsx>) |
| Billing dashboard                  | [apps/web/src/app/(dashboard)/account/billing/page.tsx](<../apps/web/src/app/(dashboard)/account/billing/page.tsx>) |
| Billing history (invoices) page    | [apps/web/src/app/(dashboard)/account/billing/invoices/page.tsx](<../apps/web/src/app/(dashboard)/account/billing/invoices/page.tsx>) |
| Invoice list organism              | [apps/web/src/components/organisms/InvoiceList/](../apps/web/src/components/organisms/InvoiceList/) |
