import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUserOncePerResponse } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getUserTeamRole,
  roleCan,
  type TeamRole,
} from "@/services/team-policy-service";
import {
  listInvites,
  type TeamInviteListRow,
} from "@/services/team-invite-service";
import { TeamSettingsConnector } from "@/connectors/TeamSettingsConnector";

export const dynamic = "force-dynamic";

interface MemberRow {
  user_id: string;
  role: TeamRole;
  created_at: string;
  email: string | null;
  full_name: string | null;
}

async function loadMembers(
  teamId: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  const { data: rows } = await admin
    .from("team_members")
    .select("user_id, role, created_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: true });

  const members = (rows ?? []) as {
    user_id: string;
    role: TeamRole;
    created_at: string;
  }[];
  if (members.length === 0) return [] as MemberRow[];

  const ids = members.map((m) => m.user_id);
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name")
    .in("id", ids);

  const { data: emails } = await admin.auth.admin
    .listUsers({ page: 1, perPage: 200 })
    .catch(() => ({ data: { users: [] } }));

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const emailById = new Map(
    (emails?.users ?? []).map((u) => [u.id, u.email ?? null]),
  );

  return members.map<MemberRow>((m) => ({
    user_id: m.user_id,
    role: m.role,
    created_at: m.created_at,
    full_name: profileById.get(m.user_id) ?? null,
    email: emailById.get(m.user_id) ?? null,
  }));
}

export default async function TeamSettingsPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  const {
    data: { user },
  } = await getAuthUserOncePerResponse();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: team } = await admin
    .from("teams")
    .select("id, name, slug, billing_user_id")
    .eq("id", teamId)
    .maybeSingle();
  if (!team) notFound();

  const role = await getUserTeamRole(teamId, user.id, admin);
  if (!role) notFound();

  const members = await loadMembers(teamId, admin);

  let invites: TeamInviteListRow[] = [];
  if (roleCan(role, "list_invites")) {
    try {
      invites = await listInvites({
        teamId,
        actorUserId: user.id,
        client: admin,
      });
    } catch {
      invites = [];
    }
  }

  return (
    <div className="space-y-8">
      <nav className="text-sm text-muted" aria-label="Breadcrumb">
        <Link href="/teams" className="hover:text-foreground">
          Teams
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <Link
          href={`/teams/${teamId}/projects`}
          className="hover:text-foreground"
        >
          {team.name}
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span className="text-foreground">Settings</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Team settings</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Manage members and invites for {team.name}. The team owner&apos;s
          subscription powers everyone&apos;s features and tokens;
          member-triggered jobs spend the owner&apos;s balance.
        </p>
      </div>

      <TeamSettingsConnector
        teamId={teamId}
        teamName={team.name}
        currentUserId={user.id}
        currentUserRole={role}
        ownerUserId={team.billing_user_id}
        members={members}
        invites={invites}
      />
    </div>
  );
}
