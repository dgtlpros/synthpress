-- ============================================================================
-- Seed: plans + token packs catalog.
-- The stripe_price_id values must be replaced with real Stripe Price IDs from
-- the Stripe dashboard before going to production. The placeholder values
-- here let local development proceed (server actions look up by `key` first).
-- ============================================================================

insert into public.plans (key, name, description, stripe_price_id, monthly_tokens, monthly_price_cents, features, is_popular, sort_order)
values
  (
    'starter',
    'Starter',
    'For solo creators',
    'price_starter_placeholder',
    1000,
    2900,
    '["1 WordPress site","1,000 synth tokens / month","AI article generation","Auto-publishing","Email support"]'::jsonb,
    false,
    1
  ),
  (
    'pro',
    'Pro',
    'For growing networks',
    'price_pro_placeholder',
    5000,
    7900,
    '["5 WordPress sites","5,000 synth tokens / month","AI article generation","Auto-publishing","MSN syndication","Priority support"]'::jsonb,
    true,
    2
  ),
  (
    'scale',
    'Scale',
    'For agencies & networks',
    'price_scale_placeholder',
    20000,
    19900,
    '["20 WordPress sites","20,000 synth tokens / month","AI article generation","Auto-publishing","MSN syndication","Dedicated support","Custom AI prompts"]'::jsonb,
    false,
    3
  )
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  stripe_price_id = excluded.stripe_price_id,
  monthly_tokens = excluded.monthly_tokens,
  monthly_price_cents = excluded.monthly_price_cents,
  features = excluded.features,
  is_popular = excluded.is_popular,
  sort_order = excluded.sort_order;

insert into public.token_packs (key, name, description, stripe_price_id, tokens, price_cents, sort_order)
values
  (
    'pack_500',
    '500 synth tokens',
    'Quick top-up for occasional bursts',
    'price_pack_500_placeholder',
    500,
    1900,
    1
  ),
  (
    'pack_2000',
    '2,000 synth tokens',
    'Best value for the average month',
    'price_pack_2000_placeholder',
    2000,
    5900,
    2
  ),
  (
    'pack_10000',
    '10,000 synth tokens',
    'Bulk pack for heavy production months',
    'price_pack_10000_placeholder',
    10000,
    24900,
    3
  )
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  stripe_price_id = excluded.stripe_price_id,
  tokens = excluded.tokens,
  price_cents = excluded.price_cents,
  sort_order = excluded.sort_order;
