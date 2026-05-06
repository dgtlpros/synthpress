-- ============================================================================
-- Team billing subject: teams.billing_user_id + single-owner invariant
-- ============================================================================
-- Promotes "team owner" to a first-class column on `teams` so the team-spend
-- RPC (added in 00012) can resolve owner -> debit -> audit in a SINGLE
-- Postgres transaction, eliminating the read-then-write race that exists
-- when resolution and consumption happen in two TS round-trips.
--
-- A trigger on `team_members` keeps `teams.billing_user_id` synced any time
-- the owner row changes (insert/update/delete), and a partial unique index
-- enforces exactly one owner per team at the DB level.
--
-- Backfill: every team currently has exactly one owner row (the creator),
-- so the backfill is straightforward. The NOT NULL constraint is set
-- AFTER the backfill so the migration is safe to apply on existing data.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Add the column (nullable initially), backfill, then enforce NOT NULL.
-- ----------------------------------------------------------------------------

alter table public.teams
  add column billing_user_id uuid references public.profiles(id) on delete restrict;

update public.teams t
  set billing_user_id = tm.user_id
  from public.team_members tm
  where tm.team_id = t.id
    and tm.role = 'owner'::public.team_role;

alter table public.teams
  alter column billing_user_id set not null;

create index teams_billing_user_id_idx on public.teams(billing_user_id);

-- ----------------------------------------------------------------------------
-- 2. Enforce exactly one owner per team.
-- ----------------------------------------------------------------------------
-- Partial unique index: at most one row per team_id where role = 'owner'.
-- Combined with the trigger below, this guarantees `teams.billing_user_id`
-- is always derived from a unique row.

create unique index teams_one_owner_idx
  on public.team_members (team_id)
  where role = 'owner'::public.team_role;

-- ----------------------------------------------------------------------------
-- 3. Trigger: keep teams.billing_user_id in sync with the owner row.
-- ----------------------------------------------------------------------------
-- Fires on INSERT / UPDATE / DELETE of `team_members`. Resolves the current
-- owner for the affected team and writes it to `teams.billing_user_id`.
-- If a team momentarily has no owner row (mid-transfer in a future feature),
-- this clears the column; downstream RPCs check for null and raise.

create or replace function public.keep_team_billing_user_id_in_sync()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_team_id uuid;
  v_owner uuid;
begin
  v_team_id := coalesce(new.team_id, old.team_id);

  select user_id into v_owner
  from public.team_members
  where team_id = v_team_id
    and role = 'owner'::public.team_role
  limit 1;

  update public.teams
  set billing_user_id = v_owner
  where id = v_team_id;

  return null;
end;
$$;

create trigger team_members_sync_billing_user_id
  after insert or update or delete on public.team_members
  for each row execute function public.keep_team_billing_user_id_in_sync();
