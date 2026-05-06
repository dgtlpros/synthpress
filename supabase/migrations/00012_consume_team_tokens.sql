-- ============================================================================
-- consume_team_tokens: atomic team-scoped spend
-- ============================================================================
-- Resolves the team's billing user (the owner), debits their token_balances,
-- and inserts an audit row in `token_transactions` ALL inside a single
-- transaction. The audit row's metadata always carries `team_id` and
-- `acting_user_id` (the member who triggered the job) so the owner's ledger
-- shows exactly what spent the tokens and on whose behalf.
--
-- Idempotency:
--   `p_idempotency_key` is the internal-job equivalent of `stripe_event_id`.
--   The fast path is the in-RPC EXISTS check; the unique partial index
--   (added in 00009) is the real safety net for concurrent retries.
--
-- Errors raised:
--   amount_must_be_positive   - p_amount <= 0
--   team_has_no_billing_user  - teams.billing_user_id is null (mid-transfer)
--   insufficient_tokens       - owner's balance < p_amount
--
-- Permissions:
--   service_role only. Server actions create the admin client and call
--   this RPC; client code never calls it directly. Mirrors the existing
--   `grant_tokens` / `record_token_refund` posture.
-- ============================================================================

create or replace function public.consume_team_tokens(
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

  -- Idempotency fast path: skip work if this key has already been consumed.
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

  update public.token_balances
    set balance = balance - p_amount,
        updated_at = now()
    where user_id = v_owner
      and balance >= p_amount
    returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'insufficient_tokens' using errcode = 'P0001';
  end if;

  begin
    insert into public.token_transactions (
      user_id, amount, type, description, metadata, idempotency_key
    )
    values (
      v_owner, -p_amount, 'usage', p_description, v_merged_metadata, p_idempotency_key
    );
  exception when unique_violation then
    -- Concurrent insert won the race on the same idempotency_key.
    -- Roll back our debit by re-crediting and return the current balance.
    update public.token_balances
      set balance = balance + p_amount,
          updated_at = now()
      where user_id = v_owner
      returning balance into v_new_balance;
    return v_new_balance;
  end;

  return v_new_balance;
end;
$$;

revoke all on function public.consume_team_tokens(uuid, int, uuid, text, jsonb, text) from public;
grant execute on function public.consume_team_tokens(uuid, int, uuid, text, jsonb, text) to service_role;

-- ----------------------------------------------------------------------------
-- Per-team usage lookup index
-- ----------------------------------------------------------------------------
-- The team usage page filters `token_transactions` by
-- `metadata->>'team_id' = $1 AND type = 'usage'`. Partial expression index
-- keeps storage tiny (only usage rows) and reads O(log n).

create index token_transactions_team_usage_idx
  on public.token_transactions ((metadata->>'team_id'))
  where type = 'usage';
