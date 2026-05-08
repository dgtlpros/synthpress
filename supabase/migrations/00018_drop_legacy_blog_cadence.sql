-- ============================================================================
-- Drop legacy cadence columns; promote `blogs.settings.automation.*` to the
-- single source of truth for autopilot configuration.
--
-- Background: migration 00001 created `blogs.is_active`, `articles_per_day`,
-- and `schedule_cron` as part of the original "WordPress site connection"
-- model. Migration 00015 introduced the richer `blogs.settings` jsonb with
-- `BlogSettings.automation` (mode, generatePerWeek, requireReview, ...).
-- The two surfaces have been coexisting in the UI ever since, with
-- conflicting semantics (e.g. `is_active=true` + `mode='manual'`).
--
-- This migration:
--   1. Backfills the jsonb from the legacy columns so no user intent is lost.
--   2. Drops the legacy columns.
--
-- Backfill rules (per the explicit product spec):
--   * `is_active = true`  → set settings.automation.mode = 'autopilot'
--                         AND settings.automation.enabled = true
--                         (overwrites any conflicting jsonb values — the user
--                         explicitly toggled the legacy switch)
--   * `is_active = false` → set settings.automation.enabled = false
--                         only when no explicit jsonb value exists
--                         (preserves user intent if they already configured
--                         autopilot via the new UI)
--   * `articles_per_day`  → set settings.automation.generatePerWeek = N * 7
--                         only when no explicit jsonb value exists
--   * `schedule_cron`     → dropped without backfill (we're moving to
--                         structured publish-window fields, not raw cron
--                         strings per blog)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Active blogs → autopilot + enabled
-- ----------------------------------------------------------------------------

update public.blogs
set settings = jsonb_set(
  jsonb_set(
    coalesce(settings, '{}'::jsonb),
    '{automation,mode}',
    '"autopilot"'::jsonb,
    true
  ),
  '{automation,enabled}',
  'true'::jsonb,
  true
)
where is_active = true;

-- ----------------------------------------------------------------------------
-- 2. Inactive blogs → enabled = false (only when not already set in jsonb)
-- ----------------------------------------------------------------------------

update public.blogs
set settings = jsonb_set(
  coalesce(settings, '{}'::jsonb),
  '{automation,enabled}',
  'false'::jsonb,
  true
)
where is_active = false
  and (settings #> '{automation,enabled}') is null;

-- ----------------------------------------------------------------------------
-- 3. articles_per_day → generatePerWeek (only when not already set)
-- ----------------------------------------------------------------------------

update public.blogs
set settings = jsonb_set(
  coalesce(settings, '{}'::jsonb),
  '{automation,generatePerWeek}',
  to_jsonb((articles_per_day * 7)::int),
  true
)
where (settings #> '{automation,generatePerWeek}') is null
  and articles_per_day is not null
  and articles_per_day > 0;

-- ----------------------------------------------------------------------------
-- 4. Drop the legacy columns
-- ----------------------------------------------------------------------------

alter table public.blogs drop column is_active;
alter table public.blogs drop column articles_per_day;
alter table public.blogs drop column schedule_cron;
