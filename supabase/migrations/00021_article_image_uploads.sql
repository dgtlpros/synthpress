-- ============================================================================
-- article_image_uploads
--
-- Per-article record of every image we've stamped onto an article's
-- featured-image slot. Two jobs:
--
--   1. **Attribution storage.** Unsplash photos must show photographer
--      credit + a profile/photo link wherever they're used (per
--      Unsplash's API guidelines). v2 surfaced the credit only inside
--      the picker; this row makes it durable so the article detail
--      page (and future inline-image flows) can render attribution
--      without re-querying Unsplash.
--
--   2. **WordPress media linkage + Unsplash download tracking.** When
--      the publish service uploads a featured image to WordPress, it
--      stamps the resulting WP attachment id here AND fires Unsplash's
--      `download_location` ping (also a guideline requirement). Caching
--      the WP media id per provider photo also lets a future "recently
--      used" reuse flow skip the upload step entirely.
--
-- Why a new table instead of more columns on `articles`:
--   * An article has ONE active featured image but may cycle through
--     several over its lifetime — each pick by the editor is a
--     historical fact worth keeping (audit / "what photo was on this
--     article during last week's republish?").
--   * Future inline images / hero variants / OG images all want the
--     same attribution shape — a row-per-image table grows naturally
--     to those without another `articles` migration.
--   * Mixed providers (Unsplash today, AI-generated tomorrow) drop in
--     by changing `provider` + the optional provider columns.
--
-- "Active" attribution = latest row WHERE article_id = X AND
-- image_url = articles.featured_image_url. Old rows stay for
-- history; the page-level loader filters by current URL. We DO NOT
-- delete on featured-image change — the editor may revert and we
-- want the original attribution to come back into view.
-- ============================================================================

create table public.article_image_uploads (
  id uuid default gen_random_uuid() primary key,
  article_id uuid references public.articles(id) on delete cascade not null,
  blog_id uuid references public.blogs(id) on delete cascade not null,

  -- Free-form provider tag. Only `'unsplash'` today; `'manual_url'`
  -- (someone pasted a URL by hand) and `'ai'` (future AI image gen)
  -- are reserved. We don't enum-constrain it because every additional
  -- provider would otherwise require a migration.
  provider text not null default 'unsplash',
  -- The provider's id for the source photo. Unsplash returns its own
  -- opaque id (`abc123`); future providers stamp whatever they have.
  -- Nullable because manual / AI flows may not have one.
  provider_photo_id text,

  -- The URL we wrote into `articles.featured_image_url`. The active-
  -- attribution lookup matches on this column so a URL change in the
  -- editor naturally swaps which row is "active".
  image_url text not null,
  alt_text text,

  -- Attribution metadata Unsplash + similar services require us to
  -- surface. Nullable because non-Unsplash providers won't have them.
  photographer_name text,
  photographer_profile_url text,
  photo_url text,
  -- Unsplash's `links.download_location` URL. The publish service
  -- GETs this exactly once (after a successful WP upload) to count
  -- the download against the photographer's stats. Cleared (null) for
  -- non-Unsplash rows.
  download_location text,

  -- WordPress attachment id once the publish service has uploaded
  -- this image. Null until first upload; set on upload-success and
  -- reused by future Update Draft / Publish Live calls. Also lets a
  -- "Recently used" picker section short-circuit the upload step
  -- when a different article on the same blog reuses the same photo.
  wp_media_id integer,

  -- Reserved for future inline / cover / OG image roles. v3 only
  -- uses `'featured'`; constraint kept open with a default.
  role text not null default 'featured',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.article_image_uploads enable row level security;

create trigger update_article_image_uploads_updated_at
  before update on public.article_image_uploads
  for each row execute function public.update_updated_at();

-- Indexes:
--   * `article_id` — the active-attribution lookup ("show me the
--     latest row for this article matching this URL").
--   * `(blog_id, created_at desc)` — the recently-used picker
--     section ("show me the last N photos used on this blog").
--   * `(provider, provider_photo_id)` — partial: future "has this
--     photo been used anywhere on this blog?" lookups before adding
--     deduplication. Cheap, not strictly required for v3.
create index article_image_uploads_article_id_idx
  on public.article_image_uploads(article_id);
create index article_image_uploads_blog_id_created_at_idx
  on public.article_image_uploads(blog_id, created_at desc);
create index article_image_uploads_provider_photo_id_idx
  on public.article_image_uploads(provider, provider_photo_id)
  where provider_photo_id is not null;

-- ----------------------------------------------------------------------------
-- RLS
--
-- Reads are scoped via blog → project → team_members (the same
-- pattern `article_jobs` and `article_ideas` use). Writes are
-- service-role only — every write happens inside an action that
-- already enforced `manage_blog`, and we add an explicit deny so the
-- intent is unambiguous.
-- ----------------------------------------------------------------------------

create policy "Members can view article image uploads in team blogs"
  on public.article_image_uploads for select
  using (
    exists (
      select 1 from public.blogs b
      join public.projects p on p.id = b.project_id
      join public.team_members tm on tm.team_id = p.team_id
      where b.id = article_image_uploads.blog_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Deny client writes to article_image_uploads"
  on public.article_image_uploads for all
  to authenticated, anon
  using (false) with check (false);
