-- ============================================================================
-- article_ideas — archive support
--
-- Adds an `archived_at` timestamp column to mark ideas the user has
-- removed from their active backlog. Archive is a non-destructive
-- soft-delete: rows stay, but the Ideas dashboard hides them by
-- default, autopilot ignores them, and they don't count toward the
-- `automation.backlogThreshold` deficit math.
--
-- Why a column (not a new `status='archived'` value):
--   * `status` is a lifecycle state machine
--     (`generated → approved/rejected → converted_to_article`). Adding
--     `archived` as a sibling would force `IDEA_STATUS_TRANSITIONS` to
--     grow archive/unarchive edges for every existing state AND lose
--     the previous state on unarchive (so a converted-to-article idea
--     archived and then unarchived would not know it had an article).
--   * `archived_at` is orthogonal to lifecycle: an idea can be
--     archived from ANY status (including `converted_to_article` —
--     hiding a published topic from the backlog while keeping the
--     "View article" link).
--   * Unarchive is a trivial `archived_at = NULL` write; no transition
--     matrix update needed.
--
-- Read paths that filter active rows use `archived_at is null`.
-- Backfill is implicit: existing rows have `archived_at = NULL` so
-- the column is invisible to anyone who didn't archive anything.
--
-- The partial index pre-computes the "active backlog" hot path used
-- by both autopilot (`listApprovedIdeasForBlog`) and the Ideas page
-- (filtering archived out before grouping by status). Partial because
-- archived rows are rare relative to active ones — indexing only
-- `archived_at is null` keeps the index tiny.
-- ============================================================================

alter table public.article_ideas
  add column if not exists archived_at timestamptz;

-- Hot read path: "list active ideas (any status) for a blog, newest
-- first". Both the Ideas page server component and the autopilot
-- scheduler hit this — the partial index keeps planner stats fresh
-- for the active subset without inflating storage for the archived
-- long tail.
create index if not exists article_ideas_blog_id_active_idx
  on public.article_ideas (blog_id, created_at desc)
  where archived_at is null;

-- Companion index for the rare "list ARCHIVED ideas for a blog" view
-- (the Archived tab on the Ideas dashboard). Separate partial so
-- the active-rows index doesn't have to scan past archived rows for
-- the common case.
create index if not exists article_ideas_blog_id_archived_idx
  on public.article_ideas (blog_id, archived_at desc)
  where archived_at is not null;
