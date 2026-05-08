import { notFound, redirect } from "next/navigation";
import {
  createClient,
  getAuthUserOncePerResponse,
} from "@/lib/supabase/server";
import { BlogSettingsConnector } from "@/connectors/BlogSettingsConnector";
import { BlogSettingsFormConnector } from "@/connectors/BlogSettingsFormConnector";
import { Card } from "@/components/atoms/Card";
import { loadBlogSettings } from "@/lib/blog-settings";
import type { BlogSettingsTabsValue } from "@/components/organisms/BlogSettingsTabs";

export const dynamic = "force-dynamic";

export default async function BlogSettingsPage({
  params,
}: {
  params: Promise<{ teamId: string; projectId: string; blogId: string }>;
}) {
  const { teamId, projectId, blogId } = await params;

  const {
    data: { user },
  } = await getAuthUserOncePerResponse();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const { data: blog } = await supabase
    .from("blogs")
    .select(
      "id, name, description, niche, keywords, ai_prompt_template, settings",
    )
    .eq("id", blogId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!blog) notFound();

  const settings = loadBlogSettings(blog.settings);

  const initialValue: BlogSettingsTabsValue = {
    general: {
      name: blog.name,
      description: blog.description ?? "",
      niche: blog.niche ?? "",
      keywordsText: (blog.keywords ?? []).join(", "),
      aiPromptTemplate: blog.ai_prompt_template ?? "",
    },
    settings,
  };

  return (
    <div className="space-y-6">
      <BlogSettingsFormConnector
        teamId={teamId}
        projectId={projectId}
        blogId={blogId}
        initialValue={initialValue}
      />

      <Card>
        <h2 className="text-base font-semibold text-foreground">Danger zone</h2>
        <p className="mt-1 text-sm text-muted">
          Renaming changes the URL slug everywhere. Deleting a blog removes all
          posts, scheduled jobs, and settings — there&apos;s no undo.
        </p>
        <div className="mt-4">
          <BlogSettingsConnector
            teamId={teamId}
            projectId={projectId}
            blogId={blogId}
            blogName={blog.name}
          />
        </div>
      </Card>
    </div>
  );
}
