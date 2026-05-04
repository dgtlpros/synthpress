-- Enable required extensions
create extension if not exists "pgcrypto";

-- Article status enum
create type article_status as enum (
  'draft',
  'generating',
  'ready',
  'publishing',
  'published',
  'failed'
);

-- ============================================================================
-- Profiles (extends auth.users)
-- ============================================================================
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  avatar_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Projects (WordPress site connections)
-- ============================================================================
create table public.projects (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  slug text not null,
  niche text not null default '',
  wp_url text not null,
  wp_username text not null,
  wp_app_password text not null,
  ai_prompt_template text not null default '',
  keywords text[] not null default '{}',
  articles_per_day int not null default 1,
  schedule_cron text not null default '0 9 * * *',
  is_active boolean not null default false,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,

  constraint projects_slug_user_unique unique (user_id, slug)
);

create index projects_user_id_idx on public.projects(user_id);

alter table public.projects enable row level security;

create policy "Users can view own projects"
  on public.projects for select
  using (auth.uid() = user_id);

create policy "Users can create own projects"
  on public.projects for insert
  with check (auth.uid() = user_id);

create policy "Users can update own projects"
  on public.projects for update
  using (auth.uid() = user_id);

create policy "Users can delete own projects"
  on public.projects for delete
  using (auth.uid() = user_id);

-- ============================================================================
-- Articles (generated/published content)
-- ============================================================================
create table public.articles (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  title text not null default '',
  content text not null default '',
  excerpt text not null default '',
  featured_image_url text,
  wp_post_id int,
  wp_post_url text,
  status article_status not null default 'draft',
  ai_model text,
  ai_prompt text,
  error_message text,
  published_at timestamptz,
  created_at timestamptz default now() not null
);

create index articles_project_id_idx on public.articles(project_id);
create index articles_status_idx on public.articles(status);

alter table public.articles enable row level security;

create policy "Users can view own articles"
  on public.articles for select
  using (
    exists (
      select 1 from public.projects
      where projects.id = articles.project_id
      and projects.user_id = auth.uid()
    )
  );

create policy "Users can create articles for own projects"
  on public.articles for insert
  with check (
    exists (
      select 1 from public.projects
      where projects.id = articles.project_id
      and projects.user_id = auth.uid()
    )
  );

create policy "Users can update own articles"
  on public.articles for update
  using (
    exists (
      select 1 from public.projects
      where projects.id = articles.project_id
      and projects.user_id = auth.uid()
    )
  );

create policy "Users can delete own articles"
  on public.articles for delete
  using (
    exists (
      select 1 from public.projects
      where projects.id = articles.project_id
      and projects.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Auto-update updated_at timestamp
-- ============================================================================
create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at();

create trigger update_projects_updated_at
  before update on public.projects
  for each row execute function public.update_updated_at();
