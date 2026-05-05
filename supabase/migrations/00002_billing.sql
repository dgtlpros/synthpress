-- ============================================================================
-- Billing: plans, subscriptions, synth tokens (credit-based)
-- ============================================================================
-- Model: signup grants 100 free synth tokens. Monthly subscription grants
-- additional tokens on each invoice. One-time top-up packs grant tokens
-- without changing the subscription. All tokens roll over forever (single
-- combined balance per user). Stripe is the source of truth for billing
-- state; webhooks reconcile into these tables idempotently via stripe_event_id.
-- ============================================================================

-- ============================================================================
-- Plans catalog (read-only catalog seeded via seed.sql)
-- ============================================================================
create table public.plans (
  key text primary key,
  name text not null,
  description text not null default '',
  stripe_price_id text,
  monthly_tokens int not null,
  monthly_price_cents int not null,
  features jsonb not null default '[]'::jsonb,
  is_popular boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz default now() not null
);

alter table public.plans enable row level security;

create policy "Plans are publicly readable"
  on public.plans for select
  using (true);

-- ============================================================================
-- Token packs catalog (one-time top-up products)
-- ============================================================================
create table public.token_packs (
  key text primary key,
  name text not null,
  description text not null default '',
  stripe_price_id text not null,
  tokens int not null check (tokens > 0),
  price_cents int not null check (price_cents > 0),
  sort_order int not null default 0,
  created_at timestamptz default now() not null
);

alter table public.token_packs enable row level security;

create policy "Token packs are publicly readable"
  on public.token_packs for select
  using (true);

-- ============================================================================
-- Stripe customers (1:1 with auth users)
-- ============================================================================
create table public.stripe_customers (
  user_id uuid references auth.users(id) on delete cascade primary key,
  stripe_customer_id text not null unique,
  created_at timestamptz default now() not null
);

alter table public.stripe_customers enable row level security;

create policy "Users can view own stripe customer"
  on public.stripe_customers for select
  using (auth.uid() = user_id);

-- ============================================================================
-- Subscriptions (mirrors Stripe subscription state)
-- ============================================================================
create table public.subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  stripe_subscription_id text not null unique,
  stripe_price_id text not null,
  plan_key text not null references public.plans(key),
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index subscriptions_user_id_idx on public.subscriptions(user_id);
create index subscriptions_status_idx on public.subscriptions(status);

alter table public.subscriptions enable row level security;

create policy "Users can view own subscriptions"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create trigger update_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.update_updated_at();

-- ============================================================================
-- Token balances (single counter per user; rollover model)
-- ============================================================================
create table public.token_balances (
  user_id uuid references auth.users(id) on delete cascade primary key,
  balance int not null default 0 check (balance >= 0),
  updated_at timestamptz default now() not null
);

alter table public.token_balances enable row level security;

create policy "Users can view own balance"
  on public.token_balances for select
  using (auth.uid() = user_id);

create trigger update_token_balances_updated_at
  before update on public.token_balances
  for each row execute function public.update_updated_at();

-- ============================================================================
-- Token transactions (audit log; idempotency via stripe_event_id)
-- ============================================================================
create table public.token_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  amount int not null,
  type text not null check (type in (
    'signup_grant',
    'subscription_grant',
    'top_up_purchase',
    'usage',
    'refund',
    'adjustment'
  )),
  description text,
  stripe_event_id text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now() not null
);

create index token_transactions_user_id_created_at_idx
  on public.token_transactions(user_id, created_at desc);

alter table public.token_transactions enable row level security;

create policy "Users can view own transactions"
  on public.token_transactions for select
  using (auth.uid() = user_id);

-- ============================================================================
-- consume_tokens: atomic deduction + audit log entry
-- Raises 'insufficient_tokens' if balance is too low. Used by AI feature code
-- once it lands; tested here as part of the billing system.
-- ============================================================================
create or replace function public.consume_tokens(
  p_user_id uuid,
  p_amount int,
  p_description text default null
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

  update public.token_balances
  set balance = balance - p_amount,
      updated_at = now()
  where user_id = p_user_id and balance >= p_amount
  returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'insufficient_tokens' using errcode = 'P0001';
  end if;

  insert into public.token_transactions (user_id, amount, type, description)
  values (p_user_id, -p_amount, 'usage', p_description);

  return v_new_balance;
end;
$$;

revoke all on function public.consume_tokens(uuid, int, text) from public;
grant execute on function public.consume_tokens(uuid, int, text) to authenticated, service_role;

-- ============================================================================
-- Extend handle_new_user: also seed token_balances + signup_grant transaction
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', '')
  );

  insert into public.token_balances (user_id, balance)
  values (new.id, 100);

  insert into public.token_transactions (user_id, amount, type, description)
  values (new.id, 100, 'signup_grant', 'Welcome bonus');

  return new;
end;
$$;
