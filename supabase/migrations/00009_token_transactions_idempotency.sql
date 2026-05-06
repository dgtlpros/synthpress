-- ============================================================================
-- Internal idempotency key for token_transactions
-- ============================================================================
-- Adds a separate `idempotency_key` column so internal jobs (team-scoped
-- automations, retries, scheduled tasks) can short-circuit duplicate writes
-- without overloading `stripe_event_id`. Keeping the two concerns separate
-- matches the project's "stripe_event_id is the lock" rule for Stripe
-- webhooks; internal jobs need their own lock that doesn't collide.
--
-- The unique partial index makes a duplicate `idempotency_key` insert raise
-- `unique_violation` (which RPCs catch and short-circuit), so the protection
-- works even when concurrent processes race past the in-RPC fast path.
-- ============================================================================

alter table public.token_transactions
  add column idempotency_key text;

create unique index token_transactions_idempotency_key_idx
  on public.token_transactions (idempotency_key)
  where idempotency_key is not null;
