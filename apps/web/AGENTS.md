<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Billing (Stripe + synth tokens)

The billing system uses **Stripe Embedded Checkout** for subscriptions and one-time
top-ups, the **Stripe Customer Portal** for managing/cancelling/upgrading, and
**Supabase** for entitlement state.

The full runbook — local setup, going to production, common operations, and the
file map — lives in **[docs/billing.md](../../docs/billing.md)**. Read that
before changing anything in:

- [src/services/stripe-service.ts](src/services/stripe-service.ts)
- [src/services/billing-service.ts](src/services/billing-service.ts)
- [src/services/token-service.ts](src/services/token-service.ts)
- [src/app/api/webhooks/stripe/route.ts](src/app/api/webhooks/stripe/route.ts)
- [supabase/migrations/00002_billing.sql](../../supabase/migrations/00002_billing.sql)
- [supabase/seed.sql](../../supabase/seed.sql)

### Quick reference

- Local setup: `pnpm stripe:setup` then `supabase db reset --local` then
  `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
- Prod: same steps with `pnpm stripe:setup --live` and a webhook endpoint added
  in the Stripe live-mode dashboard.
- Test card: `4242 4242 4242 4242`, any future expiry, any CVC.
- All client → backend mutations go `connector → hook → server action → service →
  Supabase/Stripe`. The client never imports Stripe secrets or writes to billing
  tables directly (RLS forbids it).

## Cursor rules to know

The active patterns for this codebase are encoded in `.cursor/rules/`:

- **project-architecture** (alwaysApply) — atomic-design layers, server-action
  data flow, services pattern.
- **nextjs-supabase** (apps/web/src/app, services, lib/supabase) — no browser
  Supabase, `import "server-only"` on every server module, webhook-route
  conventions.
- **supabase-database** (alwaysApply) — atomic RPC for balance/counter ops,
  `(select auth.uid())` in RLS policies, explicit deny on sensitive tables,
  partial expression indexes for hot jsonb metadata lookups, webhook
  idempotency via `stripe_event_id`.
- **component-patterns**, **testing-conventions**, **storybook-conventions**
  — atomic-design components, 100% coverage targets, CSF3 stories.
