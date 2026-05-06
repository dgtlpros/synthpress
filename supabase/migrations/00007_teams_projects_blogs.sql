-- ============================================================================
-- Teams → workspace projects → blogs (WordPress connections) → articles
-- Renames legacy `projects` (WP rows) to `blogs`; introduces team-scoped
-- `projects` as organizational containers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Types + teams + memberships
-- ----------------------------------------------------------------------------

create type public.team_role as enum ('owner', 'admin', 'member');

create table public.teams (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  slug text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index teams_created_by_idx on public.teams(created_by);

create table public.team_members (
  team_id uuid references public.teams(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role public.team_role not null default 'member',
  created_at timestamptz default now() not null,
  primary key (team_id, user_id)
);

create index team_members_user_id_idx on public.team_members(user_id);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

create trigger update_teams_updated_at
  before update on public.teams
  for each row execute function public.update_updated_at();

-- Membership check without RLS recursion (team_members policies may not
-- subquery team_members under themselves).
create or replace function public.user_is_team_member(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.user_id = p_user_id
  );
$$;

revoke all on function public.user_is_team_member(uuid, uuid) from public;
grant execute on function public.user_is_team_member(uuid, uuid) to authenticated;
grant execute on function public.user_is_team_member(uuid, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Rename legacy projects → blogs (preserves ids for articles FK)
-- ----------------------------------------------------------------------------

alter table public.projects rename to blogs;

alter trigger update_projects_updated_at on public.blogs rename to update_blogs_updated_at;

alter table public.blogs rename constraint projects_pkey to blogs_pkey;
alter table public.blogs rename constraint projects_slug_user_unique to blogs_slug_user_unique_legacy;

drop policy if exists "Users can view own projects" on public.blogs;
drop policy if exists "Users can create own projects" on public.blogs;
drop policy if exists "Users can update own projects" on public.blogs;
drop policy if exists "Users can delete own projects" on public.blogs;

-- ----------------------------------------------------------------------------
-- New team-scoped projects table (workspace container)
-- ----------------------------------------------------------------------------

create table public.projects (
  id uuid default gen_random_uuid() primary key,
  team_id uuid references public.teams(id) on delete cascade not null,
  name text not null,
  slug text not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint projects_team_slug_unique unique (team_id, slug)
);

create index projects_team_id_idx on public.projects(team_id);

alter table public.projects enable row level security;

create trigger update_workspace_projects_updated_at
  before update on public.projects
  for each row execute function public.update_updated_at();

-- ----------------------------------------------------------------------------
-- Link blogs to workspace projects
-- ----------------------------------------------------------------------------

alter table public.blogs
  add column project_id uuid references public.projects(id) on delete cascade;

-- ----------------------------------------------------------------------------
-- Backfill: one team + default project per legacy blog owner; assign blogs
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
  v_team_id uuid;
  v_project_id uuid;
begin
  for r in select distinct user_id from public.blogs
  loop
    insert into public.teams (name, slug, created_by)
    values (
      coalesce(
        nullif(trim((select coalesce(full_name, '') from public.profiles where id = r.user_id limit 1)), '')
          || '''s team',
        'Personal team'
      ),
      't-' || replace(r.user_id::text, '-', ''),
      r.user_id
    )
    returning id into v_team_id;

    insert into public.team_members (team_id, user_id, role)
    values (v_team_id, r.user_id, 'owner');

    insert into public.projects (team_id, name, slug)
    values (v_team_id, 'Default', 'default')
    returning id into v_project_id;

    update public.blogs
    set project_id = v_project_id
    where user_id = r.user_id and project_id is null;
  end loop;
end;
$$;

-- Old article policies reference blogs.user_id; drop before removing that column.
drop policy if exists "Users can view own articles" on public.articles;
drop policy if exists "Users can create articles for own projects" on public.articles;
drop policy if exists "Users can update own articles" on public.articles;
drop policy if exists "Users can delete own articles" on public.articles;

alter table public.blogs alter column project_id set not null;

alter table public.blogs drop constraint blogs_slug_user_unique_legacy;

alter table public.blogs drop constraint projects_user_id_fkey;

alter table public.blogs drop column user_id;

drop index if exists public.projects_user_id_idx;

create index blogs_project_id_idx on public.blogs(project_id);

alter table public.blogs add constraint blogs_project_slug_unique unique (project_id, slug);

-- ----------------------------------------------------------------------------
-- Articles: project_id → blog_id
-- ----------------------------------------------------------------------------

alter table public.articles rename column project_id to blog_id;

alter index articles_project_id_idx rename to articles_blog_id_idx;

alter table public.articles drop constraint if exists articles_project_id_fkey;

alter table public.articles
  add constraint articles_blog_id_fkey
  foreign key (blog_id) references public.blogs(id) on delete cascade;

-- ----------------------------------------------------------------------------
-- RLS: teams (before team_members policies that SELECT teams in WITH CHECK)
-- ----------------------------------------------------------------------------

create policy "Creators or members can view teams"
  on public.teams for select
  using (
    (select auth.uid()) = created_by
    or public.user_is_team_member(id, (select auth.uid()))
  );

create policy "Users can create teams"
  on public.teams for insert
  with check ((select auth.uid()) = created_by);

create policy "Owners can update teams"
  on public.teams for update
  using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = teams.id
      and tm.user_id = (select auth.uid())
      and tm.role = 'owner'::public.team_role
    )
  );

create policy "Owners can delete teams"
  on public.teams for delete
  using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = teams.id
      and tm.user_id = (select auth.uid())
      and tm.role = 'owner'::public.team_role
    )
  );

-- ----------------------------------------------------------------------------
-- RLS: team_members
-- ----------------------------------------------------------------------------

create policy "Members can view team memberships"
  on public.team_members for select
  using (public.user_is_team_member(team_id, (select auth.uid())));

create policy "Creators add themselves as first member"
  on public.team_members for insert
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.teams t
      where t.id = team_members.team_id
      and t.created_by = (select auth.uid())
    )
  );

create policy "Owners remove members or users leave"
  on public.team_members for delete
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = team_members.team_id
      and tm.user_id = (select auth.uid())
      and tm.role = 'owner'::public.team_role
    )
  );

create policy "Owners update member roles"
  on public.team_members for update
  using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = team_members.team_id
      and tm.user_id = (select auth.uid())
      and tm.role = 'owner'::public.team_role
    )
  );

-- ----------------------------------------------------------------------------
-- RLS: workspace projects (via team membership)
-- ----------------------------------------------------------------------------

create policy "Members can view team projects"
  on public.projects for select
  using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = projects.team_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Members can create team projects"
  on public.projects for insert
  with check (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = projects.team_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Members can update team projects"
  on public.projects for update
  using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = projects.team_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Members can delete team projects"
  on public.projects for delete
  using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = projects.team_id
      and tm.user_id = (select auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- RLS: blogs (via project → team)
-- ----------------------------------------------------------------------------

create policy "Members can view blogs in team projects"
  on public.blogs for select
  using (
    exists (
      select 1 from public.projects p
      join public.team_members tm on tm.team_id = p.team_id
      where p.id = blogs.project_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Members can create blogs in team projects"
  on public.blogs for insert
  with check (
    exists (
      select 1 from public.projects p
      join public.team_members tm on tm.team_id = p.team_id
      where p.id = blogs.project_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Members can update blogs in team projects"
  on public.blogs for update
  using (
    exists (
      select 1 from public.projects p
      join public.team_members tm on tm.team_id = p.team_id
      where p.id = blogs.project_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Members can delete blogs in team projects"
  on public.blogs for delete
  using (
    exists (
      select 1 from public.projects p
      join public.team_members tm on tm.team_id = p.team_id
      where p.id = blogs.project_id
      and tm.user_id = (select auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- RLS: articles (via blog → project → team)
-- ----------------------------------------------------------------------------

create policy "Members can view articles on team blogs"
  on public.articles for select
  using (
    exists (
      select 1 from public.blogs b
      join public.projects p on p.id = b.project_id
      join public.team_members tm on tm.team_id = p.team_id
      where b.id = articles.blog_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Members can create articles on team blogs"
  on public.articles for insert
  with check (
    exists (
      select 1 from public.blogs b
      join public.projects p on p.id = b.project_id
      join public.team_members tm on tm.team_id = p.team_id
      where b.id = articles.blog_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Members can update articles on team blogs"
  on public.articles for update
  using (
    exists (
      select 1 from public.blogs b
      join public.projects p on p.id = b.project_id
      join public.team_members tm on tm.team_id = p.team_id
      where b.id = articles.blog_id
      and tm.user_id = (select auth.uid())
    )
  );

create policy "Members can delete articles on team blogs"
  on public.articles for delete
  using (
    exists (
      select 1 from public.blogs b
      join public.projects p on p.id = b.project_id
      join public.team_members tm on tm.team_id = p.team_id
      where b.id = articles.blog_id
      and tm.user_id = (select auth.uid())
    )
  );
