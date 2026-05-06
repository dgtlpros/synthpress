import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { TeamRole } from "@/lib/team-roles";
import { getTeamPlan } from "@/services/team-billing-service";

type Client = SupabaseClient<Database>;

export type TeamListEntry = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  myRole: TeamRole;
  isOwner: boolean;
  ownerId: string;
  ownerName: string;
  /** Two-letter (or single) initials for the owner avatar fallback. */
  ownerInitials: string;
  ownerAvatarUrl: string | null;
  memberCount: number;
  projectCount: number;
  planKey: string | null;
  planStatus: string | null;
  balance: number;
};

export type TeamListGroups = {
  owned: TeamListEntry[];
  joined: TeamListEntry[];
};

function ownerInitialsFromDisplay(ownerName: string, teamName: string): string {
  const n = ownerName.trim();
  if (n === "the team owner" || n === "You") {
    const t = teamName.trim();
    if (t.length >= 2) return (t[0] + t[1]).toUpperCase();
    return t.charAt(0).toUpperCase() || "?";
  }
  if (n.includes("@")) return n.charAt(0).toUpperCase();
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  const compact = n.slice(0, 2).toUpperCase();
  /* v8 ignore next */
  return compact || "?";
}

function countByKey<T extends string>(rows: { team_id: T }[]): Map<T, number> {
  const map = new Map<T, number>();
  for (const row of rows) {
    map.set(row.team_id, (map.get(row.team_id) ?? 0) + 1);
  }
  return map;
}

/**
 * Teams the user belongs to, split into owned vs joined, with member/project
 * counts and per-team billing context (owner plan + balance).
 */
export async function listTeamsForUserWithMeta(
  userId: string,
  client: Client,
  admin: Client,
): Promise<TeamListGroups> {
  const { data: memberships, error: mErr } = await client
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", userId);

  if (mErr) throw mErr;

  const roleByTeamId = new Map<string, TeamRole>();
  for (const m of memberships ?? []) {
    roleByTeamId.set(m.team_id, m.role as TeamRole);
  }

  const teamIds = [...roleByTeamId.keys()];
  if (teamIds.length === 0) {
    return { owned: [], joined: [] };
  }

  const { data: teamRows, error: tErr } = await client
    .from("teams")
    .select("id,name,slug,created_at,billing_user_id")
    .in("id", teamIds);

  if (tErr) throw tErr;
  const teams = teamRows ?? [];

  const { data: memberRows, error: memErr } = await client
    .from("team_members")
    .select("team_id")
    .in("team_id", teamIds);

  if (memErr) throw memErr;
  const memberCountByTeam = countByKey(memberRows ?? []);

  const { data: projectRows, error: pErr } = await client
    .from("projects")
    .select("team_id")
    .in("team_id", teamIds);

  if (pErr) throw pErr;
  const projectCountByTeam = countByKey(projectRows ?? []);

  const ownerIds = [...new Set(teams.map((t) => t.billing_user_id))];
  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in("id", ownerIds);

  if (profErr) throw profErr;
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const ownerEmails = new Map<string, string>();
  for (const ownerId of ownerIds) {
    const profile = profileById.get(ownerId);
    const name = profile?.full_name?.trim();
    if (name) continue;
    if (ownerId === userId) {
      const { data, error } = await admin.auth.admin.getUserById(ownerId);
      if (!error && data.user?.email) {
        ownerEmails.set(ownerId, data.user.email);
      }
    }
  }

  const planResults = await Promise.all(teams.map((t) => getTeamPlan(t.id, admin)));

  const entries: TeamListEntry[] = teams.map((team, i) => {
    const myRole = roleByTeamId.get(team.id)!;
    const isOwner = myRole === "owner";
    const ownerId = team.billing_user_id;
    const profile = profileById.get(ownerId);
    const fullName = profile?.full_name?.trim() ?? null;
    let ownerName: string;
    if (fullName) {
      ownerName = fullName;
    } else if (ownerId === userId) {
      ownerName = ownerEmails.get(ownerId) ?? "You";
    } else {
      ownerName = "the team owner";
    }

    const plan = planResults[i];
    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      createdAt: team.created_at,
      myRole,
      isOwner,
      ownerId,
      ownerName,
      ownerInitials: ownerInitialsFromDisplay(ownerName, team.name),
      ownerAvatarUrl: profile?.avatar_url ?? null,
      memberCount: memberCountByTeam.get(team.id) ?? 0,
      projectCount: projectCountByTeam.get(team.id) ?? 0,
      planKey: plan?.planKey ?? null,
      planStatus: plan?.status ?? null,
      balance: plan?.balance ?? 0,
    };
  });

  const owned = entries.filter((e) => e.myRole === "owner").sort(/* v8 ignore next */ (a, b) => a.name.localeCompare(b.name));
  const joined = entries.filter((e) => e.myRole !== "owner").sort(/* v8 ignore next */ (a, b) => a.name.localeCompare(b.name));

  return { owned, joined };
}

/** Human-readable plan label for list rows (plan key or "Free"). */
export function teamListPlanLabel(planKey: string | null): string {
  if (!planKey) return "Free";
  return planKey
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
