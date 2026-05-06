import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUserOncePerResponse } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBalance } from "@/services/token-service";
import { getTeamPlan } from "@/services/team-billing-service";
import { listTeamsForUser } from "@/services/workspace-service";
import type { TeamRole } from "@/lib/team-roles";
import { WorkspaceSidebar, type WorkspaceSidebarTeam } from "@/components/molecules/WorkspaceSidebar";
import { MobileNavConnector } from "@/connectors/MobileNavConnector";
import {
  HeaderTokenContextConnector,
  type HeaderTeamPlan,
} from "@/connectors/HeaderTokenContextConnector";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    data: { user },
  } = await getAuthUserOncePerResponse();

  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const balance = await getBalance(user.id, admin);

  const teamRows = await listTeamsForUser(user.id, supabase);
  const teamIds = teamRows.map((t) => t.id);

  const { data: membershipRows } =
    teamIds.length > 0
      ? await supabase.from("team_members").select("team_id, role").eq("user_id", user.id).in("team_id", teamIds)
      : { data: [] as { team_id: string; role: string }[] };
  const roleByTeamId = new Map<string, TeamRole>(
    (membershipRows ?? []).map((m) => [m.team_id, m.role as TeamRole]),
  );
  const { data: projectRows } =
    teamIds.length > 0
      ? await supabase.from("projects").select("id,name,team_id").in("team_id", teamIds).order("name")
      : { data: [] as { id: string; name: string; team_id: string }[] };

  const workspaceTeams: WorkspaceSidebarTeam[] = teamRows.map((team) => ({
    id: team.id,
    name: team.name,
    projects: (projectRows ?? [])
      .filter((p) => p.team_id === team.id)
      .map((p) => ({ id: p.id, name: p.name, teamId: p.team_id })),
  }));

  // Resolve owner name + balance for every team the user is on so the header
  // token badge can swap to "Spending {team} balance (paid by {owner})" the
  // moment a team route is active. Owner profile names come in one batch.
  const teamPlanResults = await Promise.all(
    teamRows.map(async (team) => ({
      team,
      plan: await getTeamPlan(team.id, admin).catch(() => null),
    })),
  );
  const ownerIds = Array.from(
    new Set(teamPlanResults.map((r) => r.plan?.ownerId).filter(Boolean) as string[]),
  );
  const { data: ownerProfiles } =
    ownerIds.length > 0
      ? await admin.from("profiles").select("id, full_name").in("id", ownerIds)
      : { data: [] as { id: string; full_name: string | null }[] };
  const ownerNameById = new Map<string, string>(
    (ownerProfiles ?? []).map((p) => [p.id, p.full_name?.trim() || "the team owner"]),
  );
  const teamPlans: HeaderTeamPlan[] = teamPlanResults.map(({ team, plan }) => ({
    teamId: team.id,
    teamName: team.name,
    isOwner: plan?.ownerId === user.id,
    myRole: roleByTeamId.get(team.id) ?? "member",
    ownerName: plan ? ownerNameById.get(plan.ownerId) ?? "the team owner" : "the team owner",
    balance: plan?.balance ?? 0,
    planKey: plan?.planKey ?? null,
  }));

  return (
    <div className="flex min-h-screen bg-background">
      <WorkspaceSidebar teams={workspaceTeams} email={user.email} className="hidden min-h-screen lg:flex" />
      <main className="flex-1">
        <header className="flex h-16 items-center justify-between border-b border-border px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <MobileNavConnector teams={workspaceTeams} email={user.email} className="lg:hidden" />
            <Link href="/" className="flex items-center lg:hidden" aria-label="Home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/synthpress-logo-icon.svg"
                alt="SynthPress"
                className="h-8 w-auto"
              />
            </Link>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <HeaderTokenContextConnector personalBalance={balance} teamPlans={teamPlans} />
            <span className="hidden text-sm text-muted sm:inline">{user.email}</span>
          </div>
        </header>
        <div className="p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
