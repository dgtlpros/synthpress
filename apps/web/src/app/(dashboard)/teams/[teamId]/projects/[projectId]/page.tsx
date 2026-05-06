import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listBlogsForProject } from "@/services/workspace-service";
import { ProjectOverviewConnector } from "@/connectors/ProjectOverviewConnector";

export const dynamic = "force-dynamic";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ teamId: string; projectId: string }>;
}) {
  const { teamId, projectId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: team } = await supabase.from("teams").select("id,name").eq("id", teamId).maybeSingle();
  const { data: project } = await supabase
    .from("projects")
    .select("id,name,slug,team_id,description")
    .eq("id", projectId)
    .maybeSingle();

  if (!team || !project || project.team_id !== teamId) {
    notFound();
  }

  const blogs = await listBlogsForProject(projectId, supabase);

  return (
    <div className="space-y-8">
      <nav className="text-sm text-muted" aria-label="Breadcrumb">
        <Link href="/teams" className="hover:text-foreground">
          Teams
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <Link href={`/teams/${teamId}/projects`} className="hover:text-foreground">
          {team.name}
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span className="text-foreground">{project.name}</span>
      </nav>

      <ProjectOverviewConnector
        teamId={teamId}
        projectId={projectId}
        teamName={team.name}
        projectName={project.name}
        projectDescription={project.description ?? ""}
        blogs={blogs}
      />

      <p className="text-xs text-muted">
        Team invites and join-by-link are planned; membership is owner-controlled for now.
      </p>
    </div>
  );
}
