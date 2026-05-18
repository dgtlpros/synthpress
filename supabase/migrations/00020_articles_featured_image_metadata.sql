-- ============================================================================
-- Featured image metadata + WordPress media link for articles.
--
-- v1 of "WordPress images" wires up two pieces of state on `articles`:
--
--   * `featured_image_alt` — accessible alt text for the featured image.
--     Stored alongside `featured_image_url` (which has existed since the
--     initial schema). Editors set this in the article edit form; the
--     WordPress media uploader writes it onto the WP media row via
--     `PUT /wp/v2/media/{id}` so screen readers + SEO benefit on both
--     sides.
--
--   * `wp_featured_media_id` — the integer attachment id WordPress
--     returns from `POST /wp/v2/media`. Cached on the row so subsequent
--     publish/update flows reuse the same upload instead of re-pushing
--     the bytes every time. Cleared by app code whenever
--     `featured_image_url` changes (the next sync uploads the new image).
--
-- We do NOT add an `image_uploads` / `media` table or any Supabase
-- Storage wiring — v1 only supports remote URLs (provided by the user
-- or by a future Unsplash/AI-image PR). When we add Supabase Storage
-- uploads we'll either reuse `featured_image_url` (storing the public
-- URL produced by Storage) or split into an `article_assets` table
-- with proper provenance — out of scope here.
--
-- Both columns are nullable + use `if not exists` so reruns are
-- idempotent. No indexes: neither column is queried directly — both
-- are read alongside the rest of the article row via the existing
-- `articles_pkey` / `articles_blog_id_*` indexes.
-- ============================================================================

alter table public.articles
  add column if not exists featured_image_alt text,
  add column if not exists wp_featured_media_id integer;
