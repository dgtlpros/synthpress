import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/atoms/Badge";
import { Button } from "@/components/atoms/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/Card";
import { AppCard } from "@/components/molecules/AppCard";
import { EditProjectDescriptionConnector } from "@/connectors/EditProjectDescriptionConnector";

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

  const { count: blogCount } = await supabase
    .from("blogs")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  const blogsTotal = blogCount ?? 0;
  const blogHref = `/teams/${teamId}/projects/${projectId}/blogs`;

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

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{project.name}</CardTitle>
          <CardDescription>
            Scope features for <span className="text-foreground">{team.name}</span>. Install apps to add
            capabilities—start with Blog for WordPress and AI drafts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-foreground">Description</h2>
            <EditProjectDescriptionConnector
              teamId={teamId}
              projectId={projectId}
              initialDescription={project.description ?? ""}
            />
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="apps-heading">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="apps-heading" className="text-lg font-semibold text-foreground">
              Apps
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Each app adds a feature surface to this project. More apps will appear here over time.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled
            title="More apps coming soon"
            className="shrink-0 self-start sm:self-auto"
          >
            + Add app
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AppCard
            title="Blog"
            description="Connect WordPress sites, manage multiple blogs, and automate AI-assisted posts."
            href={blogHref}
            icon="📝"
            badge={<Badge variant="brand">{blogsTotal}</Badge>}
          />
          <AppCard
            title="Newsletter"
            description="Email campaigns and subscriber growth—planned."
            disabled
            icon="✉️"
          />
          <AppCard
            title="Social syndication"
            description="Cross-post and syndicate beyond WordPress—planned."
            disabled
            icon="🔗"
          />
        </div>
      </section>

      <p className="text-xs text-muted">
        Team invites and join-by-link are planned; membership is owner-controlled for now.
      </p>
    </div>
  );
}
