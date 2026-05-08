-- ============================================================================
-- refund_team_tokens: atomic team-scoped credit-back
-- ============================================================================
-- The mirror of `consume_team_tokens` (00012). Credits the team owner's
-- balance and writes a positive-amount audit row in `token_transactions`
-- with type='usage_refund'.
--
-- Use case: an AI generation job consumed credits but failed before the
-- user got their article. We give the credits back so they can retry
-- without burning money. Without this, autopilot — which can fail
-- N times in a row on a misconfigured blog — could drain a team's
-- entire monthly balance from a single bad run.
--
-- Naming note: there is already a `record_token_refund` RPC (00002).
-- That one DECREMENTS the balance to undo a Stripe-driven grant
-- (chargeback). The two flows have opposite signs and different
-- triggers, so they intentionally live as separate functions. We use
-- a distinct transaction `type` ('usage_refund' vs 'refund') so the
-- ledger is unambiguous.
--
-- Idempotency:
--   `p_idempotency_key` uses the same fast-path EXISTS check + unique
--   partial index safety net as `consume_team_tokens`. The
--   orchestration uses `refund::article_job::{jobId}` so a retried
--   failure handler is a no-op on the ledger.
--
-- Errors raised:
--   amount_must_be_positive   - p_amount <= 0
--   team_has_no_billing_user  - teams.billing_user_id is null
--
-- Permissions: service_role only (matches the consume RPC).
-- ============================================================================

create or replace function public.refund_team_tokens(
  p_team_id uuid,
  p_amount int,
  p_acting_user_id uuid,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns int
language plpgsql
security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_new_balance int;
  v_merged_metadata jsonb;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_must_be_positive' using errcode = 'P0001';
  end if;

  -- Idempotency fast path: skip work if this key has already been recorded.
  -- Returns the current owner's balance so callers can display it without
  -- a follow-up query.
  if p_idempotency_key is not null and exists (
    select 1 from public.token_transactions
    where idempotency_key = p_idempotency_key
  ) then
    return (
      select tb.balance
      from public.token_balances tb
      join public.teams t on t.billing_user_id = tb.user_id
      where t.id = p_team_id
    );
  end if;

  select billing_user_id into v_owner
  from public.teams
  where id = p_team_id;

  if v_owner is null then
    raise exception 'team_has_no_billing_user' using errcode = 'P0001';
  end if;

  v_merged_metadata := coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'team_id', p_team_id,
      'acting_user_id', p_acting_user_id
    );

  -- Credit balance back. UPSERT covers the (rare) case where the owner
  -- has no balance row materialized — usually caught by `consume_team_tokens`
  -- earlier, but defensive against weird states like "team with a stale
  -- billing_user_id whose balance row was reaped".
  insert into public.token_balances (user_id, balance, updated_at)
  values (v_owner, p_amount, now())
  on conflict (user_id) do update
    set balance = public.token_balances.balance + p_amount,
        updated_at = now()
  returning balance into v_new_balance;

  begin
    insert into public.token_transactions (
      user_id, amount, type, description, metadata, idempotency_key
    )
    values (
      v_owner,
      p_amount,
      'usage_refund',
      p_description,
      v_merged_metadata,
      p_idempotency_key
    );
  exception when unique_violation then
    -- Concurrent insert won the race on the same idempotency_key.
    -- Roll back our credit so the duplicate doesn't double-bank.
    update public.token_balances
      set balance = balance - p_amount,
          updated_at = now()
      where user_id = v_owner
      returning balance into v_new_balance;
    return v_new_balance;
  end;

  return v_new_balance;
end;
$$;

revoke all on function public.refund_team_tokens(uuid, int, uuid, text, jsonb, text) from public;
grant execute on function public.refund_team_tokens(uuid, int, uuid, text, jsonb, text) to service_role;
