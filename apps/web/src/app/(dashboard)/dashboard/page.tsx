import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUserOncePerResponse } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBalance } from "@/services/token-service";
import { listTeamsForUser } from "@/services/workspace-service";
import { Avatar } from "@/components/atoms/Avatar";
import { TokenBadge } from "@/components/atoms/TokenBadge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/Card";

export const dynamic = "force-dynamic";

const numberFormatter = new Intl.NumberFormat("en-US");

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function displayName(fullName: string | null | undefined, email: string | null | undefined) {
  const n = fullName?.trim();
  if (n) return n;
  return email ?? "there";
}

function initials(fullName: string | null | undefined, email: string | null | undefined) {
  const n = fullName?.trim();
  if (n) {
    return n
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join("");
  }
  if (email) return email.charAt(0).toUpperCase();
  return "?";
}

export default async function DashboardPage() {
  const {
    data: { user },
  } = await getAuthUserOncePerResponse();

  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const [{ data: profile }, teams, balance] = await Promise.all([
    supabase.from("profiles").select("full_name,avatar_url").eq("id", user.id).maybeSingle(),
    listTeamsForUser(user.id, supabase),
    getBalance(user.id, admin),
  ]);

  const teamIds = teams.map((t) => t.id);
  let projectCount = 0;
  let blogCount = 0;
  if (teamIds.length > 0) {
    const { count: pc } = await supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .in("team_id", teamIds);
    projectCount = pc ?? 0;

    const { data: projectRows } = await supabase.from("projects").select("id").in("team_id", teamIds);
    const projectIds = (projectRows ?? []).map((p) => p.id);
    if (projectIds.length > 0) {
      const { count: bc } = await supabase
        .from("blogs")
        .select("id", { count: "exact", head: true })
        .in("project_id", projectIds);
      blogCount = bc ?? 0;
    }
  }

  const recentTeams = [...teams]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5);

  const recentTeamIds = recentTeams.map((t) => t.id);
  const projectCountByTeam = new Map<string, number>();
  if (recentTeamIds.length > 0) {
    const { data: rp } = await supabase.from("projects").select("team_id").in("team_id", recentTeamIds);
    for (const row of rp ?? []) {
      projectCountByTeam.set(row.team_id, (projectCountByTeam.get(row.team_id) ?? 0) + 1);
    }
  }

  const name = displayName(profile?.full_name ?? undefined, user.email);
  const avatarUrl = profile?.avatar_url ?? undefined;

  return (
    <div className="space-y-10">
      <div className="rounded-[var(--sp-radius-xl)] border border-border bg-surface p-6 shadow-[var(--sp-shadow-sm)] sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar
              src={avatarUrl}
              fallback={initials(profile?.full_name ?? undefined, user.email)}
              size="lg"
              className="ring-2 ring-border"
            />
            <div>
              <p className="text-sm text-muted">{greeting()}</p>
              <h1 className="text-2xl font-bold text-foreground">{name}</h1>
              <p className="mt-1 text-sm text-muted">Here is a snapshot of your workspace.</p>
            </div>
          </div>
          <Link
            href="/account/billing"
            className="self-start sm:self-center"
            aria-label="View billing and synth tokens"
          >
            <TokenBadge balance={balance} variant={balance <= 50 ? "warning" : "brand"} size="lg" />
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Teams</CardDescription>
            <CardTitle className="text-3xl">{numberFormatter.format(teams.length)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted">People and access are grouped per team.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Projects</CardDescription>
            <CardTitle className="text-3xl">{numberFormatter.format(projectCount)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted">Each project scopes apps like Blog.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Blogs</CardDescription>
            <CardTitle className="text-3xl">{numberFormatter.format(blogCount)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted">WordPress connections across all projects.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Synth tokens</CardDescription>
            <CardTitle className="text-3xl">{numberFormatter.format(balance)}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/account/billing" className="text-xs font-medium text-brand-blue hover:underline">
              Manage billing
            </Link>
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="recent-teams-heading">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 id="recent-teams-heading" className="text-lg font-semibold text-foreground">
            Recent teams
          </h2>
          <Link href="/teams" className="text-sm font-medium text-brand-blue hover:underline">
            View all
          </Link>
        </div>
        {teams.length === 0 ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>Create your first team</CardTitle>
              <CardDescription>
                Teams hold projects; projects hold apps like Blog. Start here to wire WordPress and AI
                publishing.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/teams"
                className="inline-flex rounded-[var(--sp-radius-lg)] bg-gradient-accent px-4 py-2 text-sm font-medium text-white shadow-md hover:brightness-110"
              >
                Go to teams
              </Link>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {recentTeams.map((team) => {
              const pc = projectCountByTeam.get(team.id) ?? 0;
              return (
                <li key={team.id}>
                  <Link
                    href={`/teams/${team.id}/projects`}
                    className="flex items-center justify-between rounded-[var(--sp-radius-lg)] border border-border bg-surface px-4 py-3 text-sm shadow-sm transition-colors hover:bg-surface-hover"
                  >
                    <span className="font-medium text-foreground">{team.name}</span>
                    <span className="text-xs text-muted">
                      {pc} {pc === 1 ? "project" : "projects"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/teams" className="group block">
          <Card className="h-full transition-all hover:shadow-[var(--sp-shadow-md)]">
            <CardHeader>
              <CardTitle>Teams &amp; projects</CardTitle>
              <CardDescription>Open the workspace tree: teams, nested projects, and apps.</CardDescription>
            </CardHeader>
            <CardContent>
              <span className="text-sm font-medium text-brand-blue group-hover:underline">Go to teams →</span>
            </CardContent>
          </Card>
        </Link>

        <Link href="/account" className="group block">
          <Card className="h-full transition-all hover:shadow-[var(--sp-shadow-md)]">
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Profile, billing, invoices, and sign out.</CardDescription>
            </CardHeader>
            <CardContent>
              <span className="text-sm font-medium text-brand-blue group-hover:underline">Open account →</span>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
