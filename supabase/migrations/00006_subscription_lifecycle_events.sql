-- ============================================================================
-- Subscription lifecycle events in token_transactions
-- ============================================================================
-- The Recent Activity feed on /account/billing reads from
-- public.token_transactions. We extend the allowed `type` values so that
-- non-token events (cancellations, resumptions, plan downgrades) can be
-- recorded as 0-amount audit rows and surface in the same feed without a
-- separate table.
--
-- Token-affecting types are unchanged; the new types are purely
-- informational (amount = 0, balance untouched). Idempotency for these
-- rows uses the existing `stripe_event_id` unique index — callers
-- compose a per-transition suffix (e.g. `evt_xxx::canceled`) so multiple
-- transitions in a single Stripe event each get their own row.
-- ============================================================================

alter table public.token_transactions
  drop constraint token_transactions_type_check;

alter table public.token_transactions
  add constraint token_transactions_type_check
  check (type in (
    'signup_grant',
    'subscription_grant',
    'top_up_purchase',
    'usage',
    'refund',
    'adjustment',
    'subscription_canceled',
    'subscription_resumed',
    'plan_downgraded'
  ));
