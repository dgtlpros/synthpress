import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listTeamsForUser } from "@/services/workspace-service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/Card";
import { CreateTeamForm } from "./create-team-form";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const teams = await listTeamsForUser(user.id, supabase);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Teams</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Teams group people together. Inside a team you create projects (each project is a workspace
          for features like AI blogs). Invites and roles can grow from here.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New team</CardTitle>
          <CardDescription>You can belong to multiple teams. You will be the owner.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateTeamForm />
        </CardContent>
      </Card>

      <section aria-labelledby="teams-list-heading">
        <h2 id="teams-list-heading" className="mb-4 text-lg font-semibold text-foreground">
          Your teams
        </h2>
        {teams.length === 0 ? (
          <p className="text-sm text-muted">Create a team above to get started.</p>
        ) : (
          <ul className="space-y-2">
            {teams.map((team) => (
              <li key={team.id}>
                <Link
                  href={`/teams/${team.id}/projects`}
                  className="flex items-center justify-between rounded-[var(--sp-radius-lg)] border border-border bg-surface px-4 py-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-surface-hover"
                >
                  <span>{team.name}</span>
                  <span className="text-muted">Projects →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
