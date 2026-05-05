-- ============================================================================
-- RLS perf rewrite, explicit deny policies, and refund-lookup indexes
-- ============================================================================
-- Three things in one migration because they all live in the policy / index
-- domain:
--
-- 1. Wrap every `auth.uid() = user_id` policy in `(select auth.uid())`.
--    Postgres treats `auth.uid()` as VOLATILE which forces a per-row call;
--    `(select ...)` is treated as a stable scalar subquery and is evaluated
--    once per query. Documented Supabase performance pattern.
--
-- 2. Add explicit `WITH CHECK (false)` deny policies on the billing tables.
--    Today these tables have no INSERT/UPDATE/DELETE policies, which means
--    Postgres default-denies. The explicit `false` policy makes intent
--    unambiguous and surfaces in security audits / scanners.
--
-- 3. Two partial expression indexes on `token_transactions.metadata` to
--    keep the refund handler O(log n) as the audit log grows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Rewrite SELECT policies to use (select auth.uid())
-- ----------------------------------------------------------------------------

-- profiles
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;

create policy "Users can view own profile"
  on public.profiles for select
  using ((select auth.uid()) = id);

create policy "Users can update own profile"
  on public.profiles for update
  using ((select auth.uid()) = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check ((select auth.uid()) = id);

-- projects
drop policy if exists "Users can view own projects" on public.projects;
drop policy if exists "Users can create own projects" on public.projects;
drop policy if exists "Users can update own projects" on public.projects;
drop policy if exists "Users can delete own projects" on public.projects;

create policy "Users can view own projects"
  on public.projects for select
  using ((select auth.uid()) = user_id);

create policy "Users can create own projects"
  on public.projects for insert
  with check ((select auth.uid()) = user_id);

create policy "Users can update own projects"
  on public.projects for update
  using ((select auth.uid()) = user_id);

create policy "Users can delete own projects"
  on public.projects for delete
  using ((select auth.uid()) = user_id);

-- articles (nested via projects)
drop policy if exists "Users can view own articles" on public.articles;
drop policy if exists "Users can create articles for own projects" on public.articles;
drop policy if exists "Users can update own articles" on public.articles;
drop policy if exists "Users can delete own articles" on public.articles;

create policy "Users can view own articles"
  on public.articles for select
  using (
    exists (
      select 1 from public.projects
      where projects.id = articles.project_id
      and projects.user_id = (select auth.uid())
    )
  );

create policy "Users can create articles for own projects"
  on public.articles for insert
  with check (
    exists (
      select 1 from public.projects
      where projects.id = articles.project_id
      and projects.user_id = (select auth.uid())
    )
  );

create policy "Users can update own articles"
  on public.articles for update
  using (
    exists (
      select 1 from public.projects
      where projects.id = articles.project_id
      and projects.user_id = (select auth.uid())
    )
  );

create policy "Users can delete own articles"
  on public.articles for delete
  using (
    exists (
      select 1 from public.projects
      where projects.id = articles.project_id
      and projects.user_id = (select auth.uid())
    )
  );

-- billing tables: SELECT only via (select auth.uid())
drop policy if exists "Users can view own stripe customer" on public.stripe_customers;
drop policy if exists "Users can view own subscriptions" on public.subscriptions;
drop policy if exists "Users can view own balance" on public.token_balances;
drop policy if exists "Users can view own transactions" on public.token_transactions;

create policy "Users can view own stripe customer"
  on public.stripe_customers for select
  using ((select auth.uid()) = user_id);

create policy "Users can view own subscriptions"
  on public.subscriptions for select
  using ((select auth.uid()) = user_id);

create policy "Users can view own balance"
  on public.token_balances for select
  using ((select auth.uid()) = user_id);

create policy "Users can view own transactions"
  on public.token_transactions for select
  using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- 2. Explicit deny policies for INSERT / UPDATE / DELETE on billing tables.
-- The service-role client (used by webhooks + server actions) bypasses RLS
-- entirely, so these denies don't affect legitimate writes. They only kick
-- in if someone ever tried to mutate billing state with the anon or
-- authenticated key, e.g. `supabase.from('token_balances').update(...)`
-- from a client component (which this codebase forbids by design).
-- ----------------------------------------------------------------------------

create policy "Deny client writes to stripe_customers"
  on public.stripe_customers for all
  to authenticated, anon
  using (false)
  with check (false);

create policy "Deny client writes to subscriptions"
  on public.subscriptions for all
  to authenticated, anon
  using (false)
  with check (false);

create policy "Deny client writes to token_balances"
  on public.token_balances for all
  to authenticated, anon
  using (false)
  with check (false);

create policy "Deny client writes to token_transactions"
  on public.token_transactions for all
  to authenticated, anon
  using (false)
  with check (false);

-- ----------------------------------------------------------------------------
-- 3. Refund-lookup indexes (partial: only positive grants)
-- ----------------------------------------------------------------------------
-- The handleChargeRefunded handler queries:
--   metadata->>'stripe_invoice_id' = ?    (subscription cycles)
--   metadata->>'stripe_payment_intent_id' = ?  (top-up purchases)
-- Always with `amount > 0` (positive grants only). Partial expression
-- indexes keep the storage tiny and the seek O(log n).

create index if not exists token_transactions_invoice_idx
  on public.token_transactions ((metadata->>'stripe_invoice_id'))
  where amount > 0;

create index if not exists token_transactions_payment_intent_idx
  on public.token_transactions ((metadata->>'stripe_payment_intent_id'))
  where amount > 0;

-- ----------------------------------------------------------------------------
-- 4. Composite index for `getActiveSubscription` (user_id, status)
-- ----------------------------------------------------------------------------
-- Replaces the two single-column indexes; Postgres can still use the leading
-- column alone for user_id-only queries.

drop index if exists public.subscriptions_user_id_idx;
drop index if exists public.subscriptions_status_idx;

create index subscriptions_user_id_status_idx
  on public.subscriptions (user_id, status);
