-- ============================================================================
-- blog_autopilot_runs — WordPress draft counters (v11 reporting)
--
-- v10 added per-article-job `output.wpPublish` recording autopilot
-- WordPress draft outcomes (`draft_created`, `already_sent`,
-- `skipped_no_connection`, `failed`). This migration rolls those
-- per-job outcomes up to run-level counters so the recent-runs
-- panel + autopilot run detail drawer can show:
--
--   "5 articles · 4 drafts created · 1 already sent"
--
-- without recomputing from every job row.
--
-- Counters are written by `syncAutopilotRunWordPressDraftCounters`
-- (service helper, absolute writes) called from
-- `runGenerateArticleFromIdeaJob` after `completeArticleJob`. The
-- write is idempotent — recomputing from the current `article_jobs`
-- rows produces the same result regardless of how many times the
-- helper runs.
--
-- `wp_drafts_expected` = the sum of attempted-or-skipped outcomes
-- (created + already_sent + skipped + failed). v1 derives this
-- post-hoc from per-job output rather than predicting at queue
-- time. Manual-trigger jobs and jobs whose gates failed (no
-- `wpPublish` in their output) are NOT counted.
-- ============================================================================

alter table public.blog_autopilot_runs
  add column if not exists wp_drafts_expected integer not null default 0
    check (wp_drafts_expected >= 0),
  add column if not exists wp_drafts_created integer not null default 0
    check (wp_drafts_created >= 0),
  add column if not exists wp_drafts_already_sent integer not null default 0
    check (wp_drafts_already_sent >= 0),
  add column if not exists wp_drafts_skipped integer not null default 0
    check (wp_drafts_skipped >= 0),
  add column if not exists wp_drafts_failed integer not null default 0
    check (wp_drafts_failed >= 0);
