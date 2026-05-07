-- ============================================================================
-- Blog "fingerprint" settings + post metadata for the redesigned blog
-- detail / settings UI.
--
-- Each blog grows two new pieces of state:
--   * `description`  — plain-text marketing-style copy shown in the header.
--   * `settings`     — a single jsonb bag that holds the rich "fingerprint"
--                      (identity, content strategy, AI rules, SEO defaults,
--                      automation, publishing, media, advanced). Storing this
--                      as jsonb keeps the settings shape evolvable from the
--                      app layer without N tiny migrations as we iterate on
--                      the form. We index into it by section (`identity`,
--                      `strategy`, `ai`, `seo`, `automation`, `publishing`,
--                      `media`, `advanced`) on the TS side.
--
-- Articles (a.k.a. "posts" in the UI) get the metadata the new posts table
-- needs: `updated_at` (with trigger), `scheduled_at`, `target_keyword`,
-- `author_persona`, `word_count`. We also extend `article_status` with
-- `scheduled` and `archived` so the new status filters have somewhere to
-- live.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- blogs: description + jsonb settings
-- ----------------------------------------------------------------------------

alter table public.blogs
  add column if not exists description text not null default '',
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- article_status: add 'scheduled' and 'archived'
--
-- Postgres only allows adding enum values one at a time, and only outside a
-- transaction block. Supabase migrations run each file in its own tx, so we
-- guard with a quick lookup before each `alter type ... add value`.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'article_status' and e.enumlabel = 'scheduled'
  ) then
    alter type public.article_status add value 'scheduled' before 'publishing';
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'article_status' and e.enumlabel = 'archived'
  ) then
    alter type public.article_status add value 'archived';
  end if;
end$$;

-- ----------------------------------------------------------------------------
-- articles: post metadata
-- ----------------------------------------------------------------------------

alter table public.articles
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists scheduled_at timestamptz,
  add column if not exists target_keyword text,
  add column if not exists author_persona text,
  add column if not exists word_count int;

drop trigger if exists update_articles_updated_at on public.articles;
create trigger update_articles_updated_at
  before update on public.articles
  for each row execute function public.update_updated_at();

-- Posts dashboards filter and sort by status / scheduled / updated frequently.
create index if not exists articles_blog_id_status_idx
  on public.articles(blog_id, status);
create index if not exists articles_blog_id_scheduled_at_idx
  on public.articles(blog_id, scheduled_at)
  where scheduled_at is not null;
create index if not exists articles_blog_id_updated_at_idx
  on public.articles(blog_id, updated_at desc);
