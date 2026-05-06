"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertCan,
  TeamPermissionError,
  type TeamRole,
} from "@/services/team-policy-service";

export type ActionResult = { ok: true; error: null } | { ok: false; error: string };

/**
 * Removes a member (or invite-accepted user) from a team.
 *
 * Rules:
 *   - Caller must be owner or admin (assertCan).
 *   - The owner row cannot be removed via this action — owners must use a
 *     ownership transfer (Phase 5) or delete the team. Returns
 *     "cannot_remove_owner" without touching the row.
 *   - Self-leave is allowed (you can remove yourself if you're admin/member).
 */
export async function removeMember(teamId: string, targetUserId: string): Promise<ActionResult> {
  if (!teamId || !targetUserId) {
    return { ok: false, error: "teamId and targetUserId are required" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not signed in" };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "remove_member", admin);

    const { data: target } = await admin
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!target) {
      return { ok: false, error: "not_a_member" };
    }
    if (target.role === "owner") {
      return { ok: false, error: "cannot_remove_owner" };
    }

    const { error } = await admin
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("user_id", targetUserId);

    if (error) return { ok: false, error: error.message };

    revalidatePath(`/teams/${teamId}/settings`);
    revalidatePath(`/teams/${teamId}/projects`);
    revalidatePath("/teams");
    return { ok: true, error: null };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { ok: false, error: err.code };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Failed to remove member" };
  }
}

/**
 * Changes a member's role.
 *
 * Rules:
 *   - Caller must be owner (change_role is owner-only in v1).
 *   - The target's current role cannot be 'owner' (owner change is the
 *     transfer-ownership flow, deferred to v2).
 *   - The new role cannot be 'owner' for the same reason.
 */
export async function changeMemberRole(
  teamId: string,
  targetUserId: string,
  newRole: TeamRole,
): Promise<ActionResult> {
  if (!teamId || !targetUserId) {
    return { ok: false, error: "teamId and targetUserId are required" };
  }
  if (newRole !== "admin" && newRole !== "member") {
    return { ok: false, error: "newRole must be admin or member" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not signed in" };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "change_role", admin);

    const { data: target } = await admin
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!target) {
      return { ok: false, error: "not_a_member" };
    }
    if (target.role === "owner") {
      return { ok: false, error: "cannot_change_owner_role" };
    }
    if (target.role === newRole) {
      return { ok: true, error: null };
    }

    const { error } = await admin
      .from("team_members")
      .update({ role: newRole })
      .eq("team_id", teamId)
      .eq("user_id", targetUserId);

    if (error) return { ok: false, error: error.message };

    revalidatePath(`/teams/${teamId}/settings`);
    return { ok: true, error: null };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { ok: false, error: err.code };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Failed to change role" };
  }
}
