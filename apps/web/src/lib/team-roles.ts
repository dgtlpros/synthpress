import type { Enums } from "@/lib/supabase/database.types";

export type TeamRole = Enums<"team_role">;

/**
 * Actions a member can attempt against a team. The permission table below
 * maps each action to the set of roles that may perform it.
 *
 * Lives outside any `"server-only"` module so client components (the team
 * settings connector, etc.) can do role-based UI gating without importing
 * any service code.
 *
 * The same table is consumed by [`team-policy-service.assertCan`](../services/team-policy-service.ts)
 * — server actions are the source of truth for enforcement; the client
 * uses it only to hide buttons it knows the server will reject.
 */
export type TeamAction =
  | "invite_member"
  | "revoke_invite"
  | "list_invites"
  | "remove_member"
  | "change_role"
  | "update_team"
  | "delete_team"
  | "create_project"
  | "update_project"
  | "delete_project"
  | "manage_blog"
  | "consume_team_tokens"
  | "view_team_usage";

const ALL_ROLES: readonly TeamRole[] = ["owner", "admin", "member"] as const;
const OWNER_OR_ADMIN: readonly TeamRole[] = ["owner", "admin"] as const;
const OWNER_ONLY: readonly TeamRole[] = ["owner"] as const;

export const PERMISSIONS: Record<TeamAction, readonly TeamRole[]> = {
  invite_member: OWNER_OR_ADMIN,
  revoke_invite: OWNER_OR_ADMIN,
  list_invites: OWNER_OR_ADMIN,
  remove_member: OWNER_OR_ADMIN,
  change_role: OWNER_ONLY,
  update_team: OWNER_OR_ADMIN,
  delete_team: OWNER_ONLY,
  create_project: OWNER_OR_ADMIN,
  update_project: ALL_ROLES,
  delete_project: OWNER_OR_ADMIN,
  manage_blog: ALL_ROLES,
  consume_team_tokens: ALL_ROLES,
  view_team_usage: ALL_ROLES,
} as const;

/** Pure helper: does this role have permission for this action? */
export function roleCan(role: TeamRole, action: TeamAction): boolean {
  return PERMISSIONS[action].includes(role);
}
