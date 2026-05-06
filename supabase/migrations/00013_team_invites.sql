-- ============================================================================
-- Team invites: shareable-link membership invitations
-- ============================================================================
-- Stores invitations as (team_id, role, optional email, hashed token). The
-- raw token is ONLY ever returned from the create-invite RPC/service to the
-- inviter (so they can paste it into Slack/email/etc.); we store SHA-256 of
-- the token and compare hashes on accept. This mirrors how Supabase Auth
-- handles its own magic-link tokens (`token_hash` on `auth.flow_state`).
--
-- Email is optional:
--   - email IS NULL  => open link, anyone signed in can accept once.
--   - email IS NOT NULL => only the auth user with that email may accept;
--     a partial unique index prevents duplicate pending invites per email
--     for the same team.
--
-- All writes go through the server-only `team-invite-service.ts` using the
-- service-role client, so the RLS policy is read-only for members and
-- explicitly denies client-driven writes (matching the deny posture used
-- on billing tables in 00005).
-- ============================================================================

create table public.team_invites (
  id uuid default gen_random_uuid() primary key,
  team_id uuid references public.teams(id) on delete cascade not null,
  role public.team_role not null default 'member'::public.team_role,
  email text,
  token_hash text not null,
  invited_by uuid references public.profiles(id) on delete restrict not null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id),
  revoked_at timestamptz,
  created_at timestamptz default now() not null
);

-- One pending invite per (team, email) when email is set.
create unique index team_invites_one_pending_per_email
  on public.team_invites (team_id, lower(email))
  where email is not null
    and accepted_at is null
    and revoked_at is null;

create unique index team_invites_token_hash_idx
  on public.team_invites (token_hash);

create index team_invites_team_id_idx on public.team_invites(team_id);
create index team_invites_invited_by_idx on public.team_invites(invited_by);

alter table public.team_invites enable row level security;

-- Members of a team can see invites scoped to that team. The settings UI
-- relies on this so admins/owners can list pending invites and revoke them.
create policy "Members view team invites"
  on public.team_invites for select
  using (public.user_is_team_member(team_id, (select auth.uid())));

-- All mutation paths (create / accept / revoke) go through the service-role
-- client. Explicit deny matches the pattern used on billing tables.
create policy "Deny client writes to team_invites"
  on public.team_invites for all
  to authenticated, anon
  using (false)
  with check (false);
