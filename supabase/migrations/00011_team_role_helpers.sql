-- ============================================================================
-- Team role helpers
-- ============================================================================
-- Companion to `public.user_is_team_member` (defined in 00007). Returns the
-- caller's role within a team or NULL when they are not a member. The TS
-- `team-policy-service` wraps this with a permission table mapping each
-- action to allowed roles, used by server actions to gate invite/remove/
-- delete-team flows.
--
-- `security definer set search_path = ''` mirrors the rest of the helper
-- functions in this codebase, and matches the project rule for atomic /
-- privilege-checking RPCs.
-- ============================================================================

create or replace function public.user_team_role(p_team_id uuid, p_user_id uuid)
returns public.team_role
language sql
security definer
set search_path = ''
stable
as $$
  select role
  from public.team_members
  where team_id = p_team_id
    and user_id = p_user_id;
$$;

revoke all on function public.user_team_role(uuid, uuid) from public;
grant execute on function public.user_team_role(uuid, uuid) to authenticated;
grant execute on function public.user_team_role(uuid, uuid) to service_role;
