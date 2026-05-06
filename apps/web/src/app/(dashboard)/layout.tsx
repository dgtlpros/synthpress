import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBalance } from "@/services/token-service";
import { listTeamsForUser } from "@/services/workspace-service";
import { TokenBadge } from "@/components/atoms/TokenBadge";
import { WorkspaceSidebar, type WorkspaceSidebarTeam } from "@/components/molecules/WorkspaceSidebar";
import { MobileNavConnector } from "@/connectors/MobileNavConnector";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const balance = await getBalance(user.id, createAdminClient());

  const teamRows = await listTeamsForUser(user.id, supabase);
  const teamIds = teamRows.map((t) => t.id);
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
            <Link
              href="/account/billing"
              aria-label="View billing and synth tokens"
              className="cursor-pointer"
            >
              <TokenBadge
                balance={balance}
                variant={balance <= 50 ? "warning" : "brand"}
                size="lg"
              />
            </Link>
            <span className="hidden text-sm text-muted sm:inline">{user.email}</span>
          </div>
        </header>
        <div className="p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
