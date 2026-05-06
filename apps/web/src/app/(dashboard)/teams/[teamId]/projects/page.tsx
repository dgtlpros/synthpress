import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listProjectsForTeam } from "@/services/workspace-service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/Card";
import { CreateProjectForm } from "./create-project-form";
import { TeamProjectsListConnector } from "@/connectors/TeamProjectsListConnector";

export const dynamic = "force-dynamic";

export default async function TeamProjectsPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: team, error: teamErr } = await supabase
    .from("teams")
    .select("id,name,slug")
    .eq("id", teamId)
    .maybeSingle();

  if (teamErr || !team) {
    notFound();
  }

  const projects = await listProjectsForTeam(teamId, supabase);

  return (
    <div className="space-y-8">
      <nav className="text-sm text-muted" aria-label="Breadcrumb">
        <Link href="/teams" className="hover:text-foreground">
          Teams
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span className="text-foreground">{team.name}</span>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span>Projects</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Projects</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Projects scope features for this team. The first product is AI-powered blogs—each blog
          connects to WordPress inside a project.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New project</CardTitle>
          <CardDescription>A team can have many projects.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateProjectForm teamId={teamId} />
        </CardContent>
      </Card>

      <section aria-labelledby="project-list-heading">
        <h2 id="project-list-heading" className="mb-3 text-lg font-semibold text-foreground">
          Projects in {team.name}
        </h2>
        {projects.length === 0 ? (
          <p className="text-sm text-muted">Create a project to add blogs and automation.</p>
        ) : (
          <TeamProjectsListConnector
            teamId={teamId}
            projects={projects.map((p) => ({ id: p.id, name: p.name, created_at: p.created_at }))}
          />
        )}
      </section>
    </div>
  );
}
