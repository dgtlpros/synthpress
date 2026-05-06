import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PERMISSIONS,
  roleCan,
  type TeamAction,
  type TeamRole,
} from "@/lib/team-roles";

type Client = SupabaseClient<Database>;

export { roleCan };
export type { TeamAction, TeamRole };

/**
 * Returns the caller's role in the team, or `null` when they are not a
 * member. Calls the `user_team_role` Postgres helper so the lookup
 * matches what RLS policies see.
 */
export async function getUserTeamRole(
  teamId: string,
  userId: string,
  client?: Client,
): Promise<TeamRole | null> {
  const supabase = client ?? createAdminClient();

  const { data, error } = await supabase.rpc("user_team_role", {
    p_team_id: teamId,
    p_user_id: userId,
  });

  if (error) throw error;
  return (data as TeamRole | null) ?? null;
}

export class TeamPermissionError extends Error {
  readonly code: "not_a_member" | "forbidden";
  readonly action: TeamAction;
  readonly role: TeamRole | null;

  constructor(
    code: "not_a_member" | "forbidden",
    action: TeamAction,
    role: TeamRole | null,
  ) {
    super(
      `Forbidden: cannot ${action}` +
        (role ? ` as ${role}` : " (not a member)"),
    );
    this.name = "TeamPermissionError";
    this.code = code;
    this.action = action;
    this.role = role;
  }
}

/**
 * Throws `TeamPermissionError` when the user may not perform the action.
 * Server actions catch this and translate it into a typed error result
 * (so the UI shows a message instead of a 500).
 */
export async function assertCan(
  teamId: string,
  userId: string,
  action: TeamAction,
  client?: Client,
): Promise<TeamRole> {
  const role = await getUserTeamRole(teamId, userId, client);
  if (role === null) {
    throw new TeamPermissionError("not_a_member", action, null);
  }

  const allowed = PERMISSIONS[action];
  if (!allowed.includes(role)) {
    throw new TeamPermissionError("forbidden", action, role);
  }

  return role;
}
