-- ============================================================================
-- Atomic token operations: grant_tokens + record_token_refund
-- ============================================================================
-- Why an RPC instead of two separate Supabase queries:
--
--   The previous TypeScript implementation read the balance, computed the new
--   value, then upserted. With concurrent webhook deliveries (e.g. a Stripe
--   retry storm or simultaneous renewal + dispute events for the same user),
--   two workers could read the same balance, compute from a stale value, and
--   one event's tokens would be lost. Doing the increment inside Postgres in
--   a single transaction eliminates that race entirely.
--
-- Idempotency:
--
--   Both functions accept an optional `p_stripe_event_id`. The unique index
--   on `token_transactions.stripe_event_id` is the real safety net — a
--   duplicate insert raises `unique_violation`, which the function catches
--   and returns null/skip. The pre-check is just a fast path so we don't
--   need to roll back on every replay.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- grant_tokens: atomically insert a positive grant transaction + bump balance.
-- Returns the new balance, or NULL when the event was already processed.
-- ----------------------------------------------------------------------------
create or replace function public.grant_tokens(
  p_user_id uuid,
  p_amount int,
  p_type text,
  p_description text default null,
  p_stripe_event_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns int
language plpgsql
security definer set search_path = ''
as $$
declare
  v_new_balance int;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_must_be_positive' using errcode = 'P0001';
  end if;

  if p_type not in ('signup_grant', 'subscription_grant', 'top_up_purchase', 'adjustment') then
    raise exception 'invalid_grant_type: %', p_type using errcode = 'P0001';
  end if;

  if p_stripe_event_id is not null then
    if exists (
      select 1 from public.token_transactions
      where stripe_event_id = p_stripe_event_id
    ) then
      return null;
    end if;
  end if;

  begin
    insert into public.token_transactions (
      user_id, amount, type, description, stripe_event_id, metadata
    )
    values (
      p_user_id, p_amount, p_type, p_description, p_stripe_event_id, coalesce(p_metadata, '{}'::jsonb)
    );
  exception when unique_violation then
    return null;
  end;

  insert into public.token_balances (user_id, balance)
  values (p_user_id, p_amount)
  on conflict (user_id) do update
    set balance = public.token_balances.balance + p_amount,
        updated_at = now()
  returning balance into v_new_balance;

  return v_new_balance;
end;
$$;

revoke all on function public.grant_tokens(uuid, int, text, text, text, jsonb) from public;
grant execute on function public.grant_tokens(uuid, int, text, text, text, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- record_token_refund: atomically insert a refund transaction + decrement
-- balance, clamped at zero so we never go negative. Returns a JSONB row
-- describing what happened, or NULL when the event was already processed.
--
-- Shape of the returned object:
--   { "requested": int, "deducted": int, "balance": int }
-- ----------------------------------------------------------------------------
create or replace function public.record_token_refund(
  p_user_id uuid,
  p_amount int,
  p_stripe_event_id text default null,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_balance_before int;
  v_deducted int;
  v_new_balance int;
  v_metadata jsonb;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_must_be_positive' using errcode = 'P0001';
  end if;

  if p_stripe_event_id is not null then
    if exists (
      select 1 from public.token_transactions
      where stripe_event_id = p_stripe_event_id
    ) then
      return null;
    end if;
  end if;

  -- Lock the balance row (or treat missing as zero). FOR UPDATE makes
  -- concurrent refunds for the same user serialize on this row.
  select balance into v_balance_before
  from public.token_balances
  where user_id = p_user_id
  for update;

  v_balance_before := coalesce(v_balance_before, 0);
  v_deducted := least(p_amount, v_balance_before);
  v_new_balance := v_balance_before - v_deducted;

  v_metadata := coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'requested_amount', p_amount,
      'deducted_amount', v_deducted,
      'balance_before', v_balance_before
    );

  begin
    insert into public.token_transactions (
      user_id, amount, type, description, stripe_event_id, metadata
    )
    values (
      p_user_id,
      case when v_deducted = 0 then 0 else -v_deducted end,
      'refund',
      p_description,
      p_stripe_event_id,
      v_metadata
    );
  exception when unique_violation then
    return null;
  end;

  if v_deducted > 0 then
    insert into public.token_balances (user_id, balance)
    values (p_user_id, v_new_balance)
    on conflict (user_id) do update
      set balance = v_new_balance,
          updated_at = now();
  end if;

  return jsonb_build_object(
    'requested', p_amount,
    'deducted', v_deducted,
    'balance', v_new_balance
  );
end;
$$;

revoke all on function public.record_token_refund(uuid, int, text, text, jsonb) from public;
grant execute on function public.record_token_refund(uuid, int, text, text, jsonb) to service_role;
