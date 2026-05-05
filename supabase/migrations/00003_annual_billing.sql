-- ============================================================================
-- Annual billing: optional yearly pricing per plan.
-- Existing rows keep monthly-only pricing; annual columns are nullable so a
-- plan can opt out of an annual tier (e.g. limited-time monthly-only deals).
-- ============================================================================

alter table public.plans
  add column stripe_annual_price_id text,
  add column annual_price_cents int;
