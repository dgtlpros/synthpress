import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUserOncePerResponse } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import { getTeamPlan } from "@/services/team-billing-service";
import { getTeamUsage } from "@/services/team-usage-service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/Card";
import { LOW_BALANCE_THRESHOLD } from "@/lib/token-badge-variant";

export const dynamic = "force-dynamic";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function TeamUsagePage({
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
    .select("id, name, billing_user_id")
    .eq("id", teamId)
    .maybeSingle();
  if (!team) notFound();

  // Members get notFound; admins and owners proceed.
  let role;
  try {
    role = await assertCan(teamId, user.id, "view_team_usage", admin);
  } catch (err) {
    if (err instanceof TeamPermissionError) notFound();
    throw err;
  }

  const isOwner = role === "owner";
  const [plan, usage] = await Promise.all([
    getTeamPlan(teamId, admin),
    getTeamUsage({ teamId, client: admin }),
  ]);

  const ownerLabel = plan?.ownerId === user.id ? "you" : "the team owner";
  const remainingBalance = plan?.balance ?? 0;
  const isLowRemaining = remainingBalance <= LOW_BALANCE_THRESHOLD;

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
        <span className="text-foreground">Usage</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Token usage</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Tokens spent by automations and member-triggered jobs in {team.name}.
          All spend draws from {ownerLabel}&apos;s balance (
          <span
            className={
              isLowRemaining
                ? "font-semibold text-warning"
                : "font-semibold text-brand-lime-dark"
            }
            data-testid="usage-remaining-emphasis"
          >
            {formatNumber(remainingBalance)} tokens remaining
          </span>
          {plan?.planKey ? ` on the ${plan.planKey} plan` : ""}).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Total spent</CardTitle>
            <CardDescription>Across all team-scoped jobs</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">
              {formatNumber(usage.summary.totalSpent)}
            </p>
            <p className="mt-1 text-xs text-muted">
              {formatNumber(usage.summary.totalTransactions)} transactions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top member</CardTitle>
            <CardDescription>Who triggered the most spend</CardDescription>
          </CardHeader>
          <CardContent>
            {usage.summary.byMember[0] ? (
              <>
                <p className="text-lg font-semibold text-foreground">
                  {usage.summary.byMember[0].actingUserName ?? "Unknown member"}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {formatNumber(usage.summary.byMember[0].spent)} tokens ·{" "}
                  {formatNumber(usage.summary.byMember[0].count)} jobs
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">No usage yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top project</CardTitle>
            <CardDescription>Highest-spend project</CardDescription>
          </CardHeader>
          <CardContent>
            {usage.summary.byProject[0] ? (
              <>
                <p className="text-lg font-semibold text-foreground">
                  {usage.summary.byProject[0].projectName ??
                    "Unknown / no project"}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {formatNumber(usage.summary.byProject[0].spent)} tokens ·{" "}
                  {formatNumber(usage.summary.byProject[0].count)} jobs
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">No usage yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By member</CardTitle>
          <CardDescription>
            Tokens spent grouped by the member who triggered the job.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usage.summary.byMember.length === 0 ? (
            <p className="text-sm text-muted">No usage yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {usage.summary.byMember.map((m) => (
                <li
                  key={m.actingUserId}
                  className="flex items-center justify-between py-3"
                >
                  <span className="text-sm text-foreground">
                    {m.actingUserName ?? "Unknown member"}
                  </span>
                  <span className="text-sm text-muted">
                    {formatNumber(m.spent)} tokens · {formatNumber(m.count)}{" "}
                    jobs
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By project</CardTitle>
          <CardDescription>
            Tokens spent grouped by the project the job ran in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usage.summary.byProject.length === 0 ? (
            <p className="text-sm text-muted">No usage yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {usage.summary.byProject.map((p) => (
                <li
                  key={p.projectId}
                  className="flex items-center justify-between py-3"
                >
                  <span className="text-sm text-foreground">
                    {p.projectName ?? "Unattributed"}
                  </span>
                  <span className="text-sm text-muted">
                    {formatNumber(p.spent)} tokens · {formatNumber(p.count)}{" "}
                    jobs
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {isOwner || role === "admin" ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              Each row is a single team-scoped token consumption.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {usage.rows.length === 0 ? (
              <p className="text-sm text-muted">No usage yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted">
                      <th className="px-2 py-2 font-medium">When</th>
                      <th className="px-2 py-2 font-medium">Member</th>
                      <th className="px-2 py-2 font-medium">Project</th>
                      <th className="px-2 py-2 font-medium">Blog</th>
                      <th className="px-2 py-2 font-medium">Description</th>
                      <th className="px-2 py-2 text-right font-medium">
                        Tokens
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.rows.map((r) => (
                      <tr key={r.id} className="border-b border-border/60">
                        <td className="px-2 py-2 text-xs text-muted">
                          {formatDateTime(r.created_at)}
                        </td>
                        <td className="px-2 py-2">
                          {r.acting_user_name ?? "Unknown"}
                        </td>
                        <td className="px-2 py-2">{r.project_name ?? "—"}</td>
                        <td className="px-2 py-2">{r.blog_name ?? "—"}</td>
                        <td className="px-2 py-2 text-muted">
                          {r.description ?? ""}
                        </td>
                        <td className="px-2 py-2 text-right font-medium text-foreground">
                          -{formatNumber(Math.abs(r.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
