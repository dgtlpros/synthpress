import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  createClient,
  getAuthUserOncePerResponse,
} from "@/lib/supabase/server";
import { listBlogsForProject } from "@/services/workspace-service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/Card";
import { CreateBlogForm } from "./create-blog-form";

export const dynamic = "force-dynamic";

export default async function ProjectBlogsPage({
  params,
}: {
  params: Promise<{ teamId: string; projectId: string }>;
}) {
  const { teamId, projectId } = await params;
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
        <span className="text-foreground">Blogs</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Blogs</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Each blog has its own identity, content strategy, AI rules,
          automation, and (optionally) publishing destinations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add blog</CardTitle>
          <CardDescription>
            Just a name to start. You can configure tone, audience, and connect
            a CMS afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateBlogForm teamId={teamId} projectId={projectId} />
        </CardContent>
      </Card>

      <section aria-labelledby="blogs-list-heading">
        <h2
          id="blogs-list-heading"
          className="mb-4 text-lg font-semibold text-foreground"
        >
          Blogs in {project.name}
        </h2>
        {blogs.length === 0 ? (
          <p className="text-sm text-muted">No blogs yet. Add one above.</p>
        ) : (
          <ul className="space-y-2">
            {blogs.map((blog) => (
              <li key={blog.id}>
                <Link
                  href={`/teams/${teamId}/projects/${projectId}/blogs/${blog.id}`}
                  className="block rounded-[var(--sp-radius-lg)] border border-border bg-surface px-4 py-3 text-sm shadow-sm transition-colors hover:border-border-hover hover:bg-surface-hover"
                >
                  <p className="font-medium text-foreground">{blog.name}</p>
                  <p className="mt-1 line-clamp-1 text-xs text-muted">
                    {blog.description ||
                      blog.niche ||
                      "Configure tone, audience, and AI rules in settings."}
                  </p>
                  <p className="mt-2 text-xs font-medium text-brand-blue">
                    Open dashboard →
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
