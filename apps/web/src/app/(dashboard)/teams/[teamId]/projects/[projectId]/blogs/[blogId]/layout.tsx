import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { type ReactNode } from "react";
import {
  createClient,
  getAuthUserOncePerResponse,
} from "@/lib/supabase/server";
import { BlogHeader } from "@/components/molecules/BlogHeader";
import { BlogSubNav } from "@/components/molecules/BlogSubNav";
import { Button } from "@/components/atoms/Button";
import { loadBlogSettings } from "@/lib/blog-settings";

export const dynamic = "force-dynamic";

export default async function BlogLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ teamId: string; projectId: string; blogId: string }>;
}) {
  const { teamId, projectId, blogId } = await params;

  const {
    data: { user },
  } = await getAuthUserOncePerResponse();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const [{ data: team }, { data: project }] = await Promise.all([
    supabase.from("teams").select("id, name").eq("id", teamId).maybeSingle(),
    supabase
      .from("projects")
      .select("id, name, team_id")
      .eq("id", projectId)
      .maybeSingle(),
  ]);

  if (!team || !project || project.team_id !== teamId) {
    notFound();
  }

  const { data: blog } = await supabase
    .from("blogs")
    .select("id, name, description, settings, is_active, project_id")
    .eq("id", blogId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!blog) notFound();

  const [{ count: postCount }, { count: queueCount }] = await Promise.all([
    supabase
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("blog_id", blogId),
    supabase
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("blog_id", blogId)
      .in("status", ["generating", "ready", "scheduled"]),
  ]);

  const settings = loadBlogSettings(blog.settings);
  const blogBase = `/teams/${teamId}/projects/${projectId}/blogs/${blogId}`;

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted" aria-label="Breadcrumb">
        <Link href="/teams" className="hover:text-foreground">
          Teams
        </Link>
        <Separator />
        <Link
          href={`/teams/${teamId}/projects`}
          className="hover:text-foreground"
        >
          {team.name}
        </Link>
        <Separator />
        <Link
          href={`/teams/${teamId}/projects/${projectId}`}
          className="hover:text-foreground"
        >
          {project.name}
        </Link>
        <Separator />
        <Link
          href={`/teams/${teamId}/projects/${projectId}/blogs`}
          className="hover:text-foreground"
        >
          Blogs
        </Link>
        <Separator />
        <span className="text-foreground">{blog.name}</span>
      </nav>

      <BlogHeader
        name={blog.name}
        description={blog.description || undefined}
        automationMode={settings.automation.mode}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled
              title="Coming soon"
            >
              Generate with AI
            </Button>
            <Link
              href={`${blogBase}/settings`}
              className="inline-flex h-8 items-center justify-center rounded-[var(--sp-radius-md)] border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover"
            >
              Settings
            </Link>
          </>
        }
      />

      <BlogSubNav
        basePath={blogBase}
        items={[
          { segment: "", label: "Posts", badge: postCount ?? 0 },
          {
            segment: "queue",
            label: "Queue",
            badge: queueCount ?? 0,
            comingSoon: true,
          },
          { segment: "calendar", label: "Calendar", comingSoon: true },
          { segment: "settings", label: "Settings" },
          { segment: "connections", label: "Connections" },
          { segment: "analytics", label: "Analytics", comingSoon: true },
        ]}
      />

      <div>{children}</div>
    </div>
  );
}

function Separator() {
  return (
    <span className="mx-2" aria-hidden="true">
      /
    </span>
  );
}
