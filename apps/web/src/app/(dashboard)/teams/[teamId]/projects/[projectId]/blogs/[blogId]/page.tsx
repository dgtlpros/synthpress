import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  createClient,
  getAuthUserOncePerResponse,
} from "@/lib/supabase/server";
import { Badge } from "@/components/atoms/Badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/Card";
import { BlogSettingsConnector } from "@/connectors/BlogSettingsConnector";

export const dynamic = "force-dynamic";

export default async function BlogAppSettingsPage({
  params,
}: {
  params: Promise<{ teamId: string; projectId: string; blogId: string }>;
}) {
  const { teamId, projectId, blogId } = await params;
  const {
    data: { user },
  } = await getAuthUserOncePerResponse();

  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();

  const { data: team } = await supabase
    .from("teams")
    .select("id,name")
    .eq("id", teamId)
    .maybeSingle();
  const { data: project } = await supabase
    .from("projects")
    .select("id,name,team_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!team || !project || project.team_id !== teamId) {
    notFound();
  }

  const { data: blog, error } = await supabase
    .from("blogs")
    .select(
      "id,name,slug,wp_url,wp_username,is_active,articles_per_day,niche,keywords,schedule_cron,ai_prompt_template,created_at,updated_at,project_id",
    )
    .eq("id", blogId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error || !blog) {
    notFound();
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
        <Link
          href={`/teams/${teamId}/projects/${projectId}`}
          className="hover:text-foreground"
        >
          {project.name}
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <Link
          href={`/teams/${teamId}/projects/${projectId}/blogs`}
          className="hover:text-foreground"
        >
          Blogs
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span className="text-foreground">{blog.name}</span>
      </nav>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Blog app
        </p>
        <BlogSettingsConnector
          teamId={teamId}
          projectId={projectId}
          blogId={blogId}
          blogName={blog.name}
        />
        <div className="mt-2 flex items-center gap-3">
          <Badge variant={blog.is_active ? "brand" : "default"}>
            {blog.is_active ? "Active" : "Paused"}
          </Badge>
          <p className="text-sm text-muted">
            Settings for this WordPress connection.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
            <CardDescription>How we reach your WordPress site.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-medium text-muted">Site URL</p>
              <p className="mt-0.5 break-all text-foreground">{blog.wp_url}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted">REST user</p>
              <p className="mt-0.5 text-foreground">{blog.wp_username}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Publishing</CardTitle>
            <CardDescription>Automation cadence and targeting.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-medium text-muted">Articles per day</p>
              <p className="mt-0.5 text-foreground">{blog.articles_per_day}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted">Niche</p>
              <p className="mt-0.5 text-foreground">{blog.niche || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted">Schedule (cron)</p>
              <p className="mt-0.5 font-mono text-xs text-foreground">
                {blog.schedule_cron}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted">Keywords</p>
              <p className="mt-0.5 text-foreground">
                {(blog.keywords ?? []).length
                  ? (blog.keywords ?? []).join(", ")
                  : "—"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>AI prompt template</CardTitle>
            <CardDescription>
              Used when generating drafts for this blog.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-[var(--sp-radius-md)] border border-border bg-background p-3 text-xs text-foreground">
              {blog.ai_prompt_template || "—"}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
