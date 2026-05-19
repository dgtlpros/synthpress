-- ============================================================================
-- blogs.settings.media.imageProvider — flip legacy 'unsplash' → 'pexels'
--
-- Pexels became the active image provider in the v12 image overhaul (replaces
-- Unsplash, which was the v3 default). Existing blogs whose `settings.media`
-- was last written with `imageProvider: 'unsplash'` need to roll forward so:
--   * the autopilot picker uses Pexels for new articles, and
--   * the settings UI dropdown (which no longer offers 'unsplash') doesn't
--     render an unselectable value on first paint.
--
-- The TS-side normalizer in `apps/web/src/lib/blog-settings.ts`
-- (`pickImageProvider`) ALSO coerces stored 'unsplash' to 'pexels' at read
-- time — that's the belt-and-braces guard for any blog seeded between this
-- migration and the next per-blog save. This migration is the one-shot pass
-- that makes the persisted jsonb consistent with the runtime view.
--
-- Why a one-shot UPDATE (not a CHECK constraint or a generated column):
--   `settings` is jsonb that the app evolves freely; pinning a constraint on
--   a single nested key would couple the schema to the app's enum churn.
--   The TS normalizer is the authoritative validator on read, the migration
--   is the authoritative cleanup on write history.
--
-- IMPORTANT — what we DO NOT touch:
--   * `article_image_uploads` rows with `provider='unsplash'`. Those are
--     historical attribution records for already-published images. They keep
--     rendering Unsplash credit lines + still ping the Unsplash
--     `download_location` on WordPress sync (legacy provider stays
--     registered for that exact reason). See
--     `apps/web/src/services/image-providers/registry.ts` for the legacy
--     posture.
--   * Any other `settings` keys. Even the `media.imageSource` axis ('coming
--     soon' stubs) is left alone — it doesn't drive any active behavior.
-- ============================================================================

update public.blogs
set settings = jsonb_set(
  settings,
  '{media,imageProvider}',
  '"pexels"'::jsonb,
  true
)
where settings->'media'->>'imageProvider' = 'unsplash';
