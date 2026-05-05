<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Billing (Stripe + synth tokens)

The app uses **Stripe Embedded Checkout** for both subscriptions and one-time
top-ups, and the **Stripe Customer Portal** for managing/cancelling
subscriptions and updating payment methods. All Stripe writes happen
server-side; the client only receives a `client_secret` to mount the
Embedded Checkout drop-in.

### Domain model

- **Plans** (`public.plans`): catalog seeded from `supabase/seed.sql`. Each row
  has a `stripe_price_id` referencing a Stripe recurring price.
- **Token packs** (`public.token_packs`): catalog of one-time top-up products
  also seeded from `seed.sql` and linked to Stripe one-time prices.
- **Synth tokens** (`public.token_balances`, `public.token_transactions`):
  every user has a single integer balance. Tokens roll over forever. Grants
  (signup, subscription, top-up) are positive entries; consumption is
  negative. Webhook idempotency is enforced by the unique
  `token_transactions.stripe_event_id` index.
- **Signup grant**: `handle_new_user()` (in `00002_billing.sql`) inserts a
  `token_balances (user_id, 100)` row for every new user.

### Code layout

- Server actions: [src/actions/billing.ts](src/actions/billing.ts),
  [src/actions/tokens.ts](src/actions/tokens.ts).
- Services: [src/services/stripe-service.ts](src/services/stripe-service.ts),
  [src/services/billing-service.ts](src/services/billing-service.ts),
  [src/services/token-service.ts](src/services/token-service.ts).
- Webhook route: [src/app/api/webhooks/stripe/route.ts](src/app/api/webhooks/stripe/route.ts)
  (whitelisted in `middleware.ts`).
- Client wrapper: [src/lib/stripe-browser.ts](src/lib/stripe-browser.ts).
- UI: pricing page at [src/app/pricing/page.tsx](src/app/pricing/page.tsx),
  embedded checkout at
  [src/app/(dashboard)/checkout/page.tsx](src/app/(dashboard)/checkout/page.tsx),
  and the billing dashboard at
  [src/app/(dashboard)/account/billing/page.tsx](src/app/(dashboard)/account/billing/page.tsx).

### Required env vars

```
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`SUPABASE_SERVICE_ROLE_KEY` is also required so server code can write to
billing tables that have RLS enabled (clients cannot write directly).

### Local Stripe webhook setup

```bash
# 1. Create test products in Stripe and copy each Price ID
#    into supabase/seed.sql, then `supabase db reset --local`.
# 2. Run the dev server.
pnpm dev

# 3. In a second terminal, forward Stripe events into the dev server.
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# Copy the printed `whsec_...` into apps/web/.env.local as STRIPE_WEBHOOK_SECRET
# and restart the dev server.

# 4. Trigger an event manually if needed:
stripe trigger checkout.session.completed
```

### Manual end-to-end smoke test

1. Sign up for a new account → verify the dashboard header shows `100 tokens`
   (the signup grant from `handle_new_user`).
2. Go to `/pricing` and click `Subscribe` on Pro → `/checkout?plan=pro`.
3. Use Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC.
4. After payment, you'll land on `/checkout/return` → click "Go to billing".
5. Verify `/account/billing` shows the `Pro` plan, the renewal date, and a
   `5,100` token balance (100 signup + 5,000 from the plan grant).
6. Click `Buy now` on a top-up pack → complete the payment with the same
   test card → verify the balance and recent activity updates.

### Stripe API version

The SDK pinned in `package.json` (currently `stripe@^22`) ships with types
matching the Dahlia API version. We accept whatever default version the
library exposes; if you need to pin, pass `apiVersion` to `new Stripe(...)`
inside `getStripe()` in `src/services/stripe-service.ts`.
