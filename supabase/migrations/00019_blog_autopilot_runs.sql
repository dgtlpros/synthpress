-- ============================================================================
-- blog_autopilot_runs — audit / state log for the autopilot scheduler
--
-- Each row is a single attempt by the scheduler (cron tick, manual
-- "run now", future Vercel Workflow execution) to evaluate or generate
-- content for one blog. The shape lets a future ops dashboard answer:
--
--   * When did autopilot run for this blog?
--   * What did it try to do? (input jsonb + counters)
--   * What did it actually produce? (output jsonb + counters)
--   * Where did it fail? (current_step + error_message)
--   * Should autopilot pause due to repeated failures?
--     (failure-rate / refund-rate queries over recent rows)
--
-- This is intentionally separate from `article_jobs`:
--
--   * `article_jobs` is the per-piece generation unit (one job per
--     idea-batch / article-draft / outline). One autopilot run can
--     spawn many article_jobs.
--   * `blog_autopilot_runs` is the per-tick scheduler unit. It owns
--     the rollup counters (ideas_generated, articles_*) and the
--     decision context (loaded settings, budget snapshot).
--
-- Posture follows `supabase-database` rule: writes go through the
-- service-role client used by the cron route / workflow runner, so
-- this table is default-deny for authenticated / anon. Reads are
-- team-scoped via the standard `blogs → projects → team_members`
-- chain.
-- ============================================================================

create table public.blog_autopilot_runs (
  id uuid default gen_random_uuid() primary key,

  -- Denormalized scope columns. Keeping `team_id` and `project_id` here
  -- (instead of joining through blog → project → team for every query)
  -- lets the future ops dashboard answer "show me every autopilot run
  -- for team T this week" with a single index hit, and survives a blog
  -- being deleted in the audit log if we ever loosen the FK.
  team_id uuid references public.teams(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete cascade not null,
  blog_id uuid references public.blogs(id) on delete cascade not null,

  -- Set when a human kicked the run via "Run autopilot now". Null when
  -- it came from cron / workflow / system.
  triggered_by_user_id uuid references public.profiles(id) on delete set null,

  -- Where this run originated. `cron` is the default because most rows
  -- will be scheduled. `system` is reserved for internal bookkeeping
  -- (e.g. a backfill script).
  trigger_source text not null default 'cron'
    check (trigger_source in ('cron', 'manual', 'workflow', 'system')),

  -- Lifecycle. `skipped` is unique to this table — autopilot may decide
  -- "no work to do" (backlog full, daily token cap hit, mode is manual,
  -- enabled is false) and we want that to be a first-class outcome
  -- rather than masquerading as `completed`.
  status text not null default 'pending'
    check (status in (
      'pending',
      'processing',
      'completed',
      'failed',
      'cancelled',
      'skipped'
    )),

  -- Free-form so the workflow can grow new step names without a
  -- migration per addition. The known set lives in the TS service
  -- layer (`BLOG_AUTOPILOT_RUN_STEPS`).
  current_step text,

  error_message text,

  -- Inputs the orchestration captured (settings snapshot, budget cap,
  -- backlog count, model overrides) and outputs (jobs spawned, refund
  -- aggregates, model names, decision rationale). Both jsonb so the
  -- shape can evolve from app code.
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,

  -- Rollup counters incremented as the run progresses. Always >= 0.
  -- Stored as integers (not numeric) — autopilot caps these well
  -- below 2^31 and the dashboard does no per-row arithmetic that needs
  -- exact decimals.
  ideas_generated integer not null default 0
    check (ideas_generated >= 0),
  articles_started integer not null default 0
    check (articles_started >= 0),
  articles_completed integer not null default 0
    check (articles_completed >= 0),
  articles_failed integer not null default 0
    check (articles_failed >= 0),
  tokens_spent integer not null default 0
    check (tokens_spent >= 0),
  tokens_refunded integer not null default 0
    check (tokens_refunded >= 0),

  -- Timestamps
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Indexes
--
-- * (blog_id, created_at desc) — "recent runs for this blog" feeds the
--   future per-blog ops drawer.
-- * (team_id, created_at desc) — "recent runs for this team" feeds the
--   team-wide ops dashboard.
-- * (status) — partial on the actively-interesting statuses keeps the
--   index tiny; cron uses it to find pending/processing rows that need
--   to be advanced or timed out.
-- * (scheduled_for) — partial on rows that have a future timestamp
--   feeds "what's queued to run next" without scanning the whole table.
-- * (trigger_source) — small partial for ops queries that want to
--   isolate manual reruns from scheduled ticks.
-- ----------------------------------------------------------------------------

create index blog_autopilot_runs_blog_id_created_at_idx
  on public.blog_autopilot_runs(blog_id, created_at desc);

create index blog_autopilot_runs_team_id_created_at_idx
  on public.blog_autopilot_runs(team_id, created_at desc);

create index blog_autopilot_runs_status_idx
  on public.blog_autopilot_runs(status)
  where status in ('pending', 'processing');

create index blog_autopilot_runs_scheduled_for_idx
  on public.blog_autopilot_runs(scheduled_for)
  where scheduled_for is not null and status = 'pending';

create index blog_autopilot_runs_trigger_source_idx
  on public.blog_autopilot_runs(trigger_source)
  where trigger_source <> 'cron';

-- ----------------------------------------------------------------------------
-- Updated_at trigger (uses the project-wide helper from 00001)
-- ----------------------------------------------------------------------------

create trigger update_blog_autopilot_runs_updated_at
  before update on public.blog_autopilot_runs
  for each row execute function public.update_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
--
-- Reads: team members can see runs in their team's blogs, mirroring
-- the article_jobs / article_ideas pattern.
--
-- Writes: cron + workflow runners use the service-role client (which
-- bypasses RLS), so we explicitly deny client writes to make the intent
-- unmistakable.
-- ----------------------------------------------------------------------------

alter table public.blog_autopilot_runs enable row level security;

create policy "Members can view autopilot runs in team blogs"
  on public.blog_autopilot_runs for select
  using (
    exists (
      select 1 from public.blogs b
      join public.projects p on p.id = b.project_id
      join public.team_members tm on tm.team_id = p.team_id
      where b.id = blog_autopilot_runs.blog_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Deny client writes to blog_autopilot_runs"
  on public.blog_autopilot_runs for all
  to authenticated, anon
  using (false) with check (false);
