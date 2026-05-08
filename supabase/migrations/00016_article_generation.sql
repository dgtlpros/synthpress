-- ============================================================================
-- AI article generation foundation
--
-- Adds the durable state shape the future manual + autopilot pipelines
-- will write to:
--
--   * `article_ideas`        — one row per generated topic. Owned by the
--                              blog (team-scoped via blog_id). Goes
--                              through approve / reject / convert
--                              transitions before becoming an article.
--   * `articles`             — already exists (00001 → 00007 → 00015).
--                              Gets the columns the AI flow needs to
--                              populate: link to the source idea, full
--                              Markdown body, slug, meta description,
--                              raw provider response, model + acting
--                              user trail.
--   * `article_jobs`         — durable execution unit. One row per
--                              generation attempt; future Vercel
--                              Workflow runs map each `"use step"`
--                              boundary to an `current_step` update.
--   * `usage_events`         — per-call audit log of token spend at the
--                              provider level. Sits next to (not
--                              inside of) `token_transactions`: that
--                              table is the synth-token ledger keyed
--                              to the team owner; this one captures
--                              raw Claude tokens / estimated $ cost
--                              for profitability analysis.
--
-- Posture follows the supabase-database rule: `article_jobs` and
-- `usage_events` are billing/audit data, so they get default-deny on
-- writes for `authenticated` / `anon` plus an explicit deny policy.
-- All writes to those two come from server-role (service_role) clients.
-- `article_ideas` matches the existing `articles` policy: any team
-- member can CRUD inside their team's blogs.
--
-- Ownership: this codebase uses team ownership (blog → project →
-- team_members) for content. Where the spec calls for `user_id`, we
-- store it as the *acting user* — the team member who triggered the
-- work — and resolve permissions via team membership. `user_id` is
-- therefore `references public.profiles(id) on delete set null` so a
-- member leaving doesn't take their team's content / audit log with
-- them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- articles: extend the existing enum and add the AI-generation columns
-- ----------------------------------------------------------------------------
--
-- The status spec asks for `ready_for_review`. The existing
-- `article_status` enum has `ready` (legacy) but not `ready_for_review`.
-- Postgres only allows one enum value addition at a time and only
-- outside a transaction block — we guard with the same conditional
-- pattern as 00015.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'article_status' and e.enumlabel = 'ready_for_review'
  ) then
    alter type public.article_status add value 'ready_for_review' after 'ready';
  end if;
end$$;

alter table public.articles
  add column if not exists user_id uuid references public.profiles(id) on delete set null,
  add column if not exists article_idea_id uuid,
  add column if not exists content_markdown text,
  add column if not exists meta_description text,
  add column if not exists slug text,
  add column if not exists generated_by_model text,
  add column if not exists raw_ai_response jsonb;

create unique index if not exists articles_blog_id_slug_unique
  on public.articles(blog_id, slug)
  where slug is not null;

create index if not exists articles_user_id_idx
  on public.articles(user_id)
  where user_id is not null;

-- ----------------------------------------------------------------------------
-- article_ideas
-- ----------------------------------------------------------------------------

create table public.article_ideas (
  id uuid default gen_random_uuid() primary key,
  blog_id uuid references public.blogs(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete set null,

  title text not null,
  slug text,
  target_keyword text,
  executive_summary text,
  article_type text,
  estimated_word_count integer,

  -- Lifecycle: generated → approved/rejected → converted_to_article.
  -- Plain text + check constraint keeps the value set evolvable from
  -- app code without a migration per addition (vs. a Postgres enum).
  status text not null default 'generated'
    check (status in ('generated', 'approved', 'rejected', 'converted_to_article')),

  raw_ai_response jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index article_ideas_blog_id_idx on public.article_ideas(blog_id);
create index article_ideas_blog_id_status_idx
  on public.article_ideas(blog_id, status);
create index article_ideas_user_id_idx
  on public.article_ideas(user_id)
  where user_id is not null;

alter table public.article_ideas enable row level security;

create trigger update_article_ideas_updated_at
  before update on public.article_ideas
  for each row execute function public.update_updated_at();

create policy "Members can view article ideas in team blogs"
  on public.article_ideas for select
  using (
    exists (
      select 1 from public.blogs b
      join public.projects p on p.id = b.project_id
      join public.team_members tm on tm.team_id = p.team_id
      where b.id = article_ideas.blog_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Members can create article ideas in team blogs"
  on public.article_ideas for insert
  with check (
    exists (
      select 1 from public.blogs b
      join public.projects p on p.id = b.project_id
      join public.team_members tm on tm.team_id = p.team_id
      where b.id = article_ideas.blog_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Members can update article ideas in team blogs"
  on public.article_ideas for update
  using (
    exists (
      select 1 from public.blogs b
      join public.projects p on p.id = b.project_id
      join public.team_members tm on tm.team_id = p.team_id
      where b.id = article_ideas.blog_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Members can delete article ideas in team blogs"
  on public.article_ideas for delete
  using (
    exists (
      select 1 from public.blogs b
      join public.projects p on p.id = b.project_id
      join public.team_members tm on tm.team_id = p.team_id
      where b.id = article_ideas.blog_id
      and tm.user_id = (select auth.uid())
    )
  );

-- Now that article_ideas exists, attach the FK from articles.article_idea_id.
-- We added the column earlier without a constraint so the alter table doesn't
-- fail on the chicken-and-egg ordering.
alter table public.articles
  add constraint articles_article_idea_id_fkey
  foreign key (article_idea_id)
  references public.article_ideas(id)
  on delete set null;

create index if not exists articles_article_idea_id_idx
  on public.articles(article_idea_id)
  where article_idea_id is not null;

-- ----------------------------------------------------------------------------
-- article_jobs
-- ----------------------------------------------------------------------------
--
-- type: which kind of generation step this row represents. Each step
-- in the future Vercel Workflow gets its own job row so we can retry
-- and bill them independently.
--
-- status: lifecycle of the job. The `processing` value (vs. the more
-- common `running`) matches the spec the dashboard will read.
--
-- current_step: free-form text matching the workflow step constant.
-- Not constrained because we expect to add new step names without a
-- migration as the workflow grows.
-- ----------------------------------------------------------------------------

create table public.article_jobs (
  id uuid default gen_random_uuid() primary key,
  blog_id uuid references public.blogs(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete set null,
  article_id uuid references public.articles(id) on delete set null,
  article_idea_id uuid references public.article_ideas(id) on delete set null,

  type text not null
    check (type in ('generate_ideas', 'generate_outline', 'generate_article')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  current_step text,
  error_message text,

  -- Inputs the orchestration passed (brief, model overrides, etc.) and
  -- captured outputs (model name, token counts, cost estimate, etc.).
  -- Both jsonb so the shape can evolve without a migration per field.
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,

  attempts integer not null default 0,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index article_jobs_blog_id_idx on public.article_jobs(blog_id);
create index article_jobs_blog_id_status_idx
  on public.article_jobs(blog_id, status);
create index article_jobs_article_id_idx
  on public.article_jobs(article_id)
  where article_id is not null;
create index article_jobs_article_idea_id_idx
  on public.article_jobs(article_idea_id)
  where article_idea_id is not null;
create index article_jobs_user_id_idx
  on public.article_jobs(user_id)
  where user_id is not null;

alter table public.article_jobs enable row level security;

create trigger update_article_jobs_updated_at
  before update on public.article_jobs
  for each row execute function public.update_updated_at();

create policy "Members can view article jobs in team blogs"
  on public.article_jobs for select
  using (
    exists (
      select 1 from public.blogs b
      join public.projects p on p.id = b.project_id
      join public.team_members tm on tm.team_id = p.team_id
      where b.id = article_jobs.blog_id
      and tm.user_id = (select auth.uid())
    )
  );

-- Default-deny on writes. Each row corresponds to a credit spend; the
-- orchestration code creates / updates rows from the server using the
-- service-role client (which bypasses RLS). An explicit deny policy
-- makes the intent unmistakable in policy review.
create policy "Deny client writes to article_jobs"
  on public.article_jobs for all
  to authenticated, anon
  using (false) with check (false);

-- ----------------------------------------------------------------------------
-- usage_events
-- ----------------------------------------------------------------------------
--
-- Per-call audit of provider token spend. Lives next to
-- `token_transactions` rather than inside it: token_transactions is the
-- synth-token ledger (what the user is charged), this one captures raw
-- provider tokens + estimated $ cost (what we paid the provider). Two
-- rows per article: one in token_transactions (credits_used) and one
-- here (input_tokens, output_tokens, estimated_cost), linked via
-- `job_id`.
-- ----------------------------------------------------------------------------

create table public.usage_events (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete set null,
  blog_id uuid references public.blogs(id) on delete cascade,
  article_id uuid references public.articles(id) on delete set null,
  article_idea_id uuid references public.article_ideas(id) on delete set null,
  job_id uuid references public.article_jobs(id) on delete set null,

  provider text,
  model text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost numeric(12, 6),
  credits_used integer,

  created_at timestamptz not null default now()
);

-- Profitability dashboards filter by blog + day; per-user analyses
-- filter by user_id. Two narrow indexes are cheaper than one wide one.
create index usage_events_blog_id_created_at_idx
  on public.usage_events(blog_id, created_at desc)
  where blog_id is not null;
create index usage_events_user_id_created_at_idx
  on public.usage_events(user_id, created_at desc)
  where user_id is not null;
create index usage_events_job_id_idx
  on public.usage_events(job_id)
  where job_id is not null;

alter table public.usage_events enable row level security;

create policy "Members can view usage events in team blogs"
  on public.usage_events for select
  using (
    blog_id is not null and exists (
      select 1 from public.blogs b
      join public.projects p on p.id = b.project_id
      join public.team_members tm on tm.team_id = p.team_id
      where b.id = usage_events.blog_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Deny client writes to usage_events"
  on public.usage_events for all
  to authenticated, anon
  using (false) with check (false);
