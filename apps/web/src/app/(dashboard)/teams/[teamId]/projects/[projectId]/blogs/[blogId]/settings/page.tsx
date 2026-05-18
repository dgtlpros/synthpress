import { notFound, redirect } from "next/navigation";
import {
  createClient,
  getAuthUserOncePerResponse,
} from "@/lib/supabase/server";
import { BlogAutopilotPanelConnector } from "@/connectors/BlogAutopilotPanelConnector";
import { BlogSettingsConnector } from "@/connectors/BlogSettingsConnector";
import { BlogSettingsFormConnector } from "@/connectors/BlogSettingsFormConnector";
import { Card } from "@/components/atoms/Card";
import type { AutopilotRunRowData } from "@/components/molecules/AutopilotRunRow";
import type { AutopilotRunStatus } from "@/components/atoms/AutopilotRunStatusBadge";
import { loadBlogSettings } from "@/lib/blog-settings";
import { listBlogAutopilotRunsForBlog } from "@/services/blog-autopilot-run-service";
import type { BlogSettingsTabsValue } from "@/components/organisms/BlogSettingsTabs";

export const dynamic = "force-dynamic";

const RECENT_RUNS_LIMIT = 10;

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
      "id, name, description, niche, keywords, ai_prompt_template, settings, wp_url, wp_username, wp_app_password",
    )
    .eq("id", blogId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!blog) notFound();

  const settings = loadBlogSettings(blog.settings);
  // Derive the WordPress connection presence boolean here (server
  // component) so the Publishing tab can gate its "auto-send to WP
  // draft" toggle without re-querying Supabase from the client. We
  // never expose the password — only the boolean.
  const hasWordPressConnection = Boolean(
    blog.wp_url?.trim() &&
      blog.wp_username?.trim() &&
      blog.wp_app_password?.trim(),
  );
  const autopilotEnabled =
    settings.automation.mode === "autopilot" && settings.automation.enabled;

  // Recent autopilot runs feed the in-page panel. The list helper
  // accepts a user-context client and `blog_autopilot_runs` has
  // SELECT RLS for team members, so this read is naturally scoped
  // without us threading admin credentials.
  const runRows = await listBlogAutopilotRunsForBlog(blogId, {
    limit: RECENT_RUNS_LIMIT,
    client: supabase,
  });
  const recentRuns: AutopilotRunRowData[] = runRows.map((row) => ({
    id: row.id,
    status: row.status as AutopilotRunStatus,
    triggerSource: row.trigger_source,
    currentStep: row.current_step,
    errorMessage: row.error_message,
    output:
      row.output && typeof row.output === "object" && !Array.isArray(row.output)
        ? (row.output as Record<string, unknown>)
        : null,
    ideasGenerated: row.ideas_generated,
    articlesStarted: row.articles_started,
    articlesCompleted: row.articles_completed,
    articlesFailed: row.articles_failed,
    tokensSpent: row.tokens_spent,
    tokensRefunded: row.tokens_refunded,
    wpDraftsExpected: row.wp_drafts_expected,
    wpDraftsCreated: row.wp_drafts_created,
    wpDraftsAlreadySent: row.wp_drafts_already_sent,
    wpDraftsSkipped: row.wp_drafts_skipped,
    wpDraftsFailed: row.wp_drafts_failed,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }));

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
        hasWordPressConnection={hasWordPressConnection}
      />

      <BlogAutopilotPanelConnector
        teamId={teamId}
        projectId={projectId}
        blogId={blogId}
        blogName={blog.name}
        autopilotEnabled={autopilotEnabled}
        recentRuns={recentRuns}
        pausedReason={settings.automation.pausedReason}
        pausedAt={settings.automation.pausedAt}
        pausedMessage={settings.automation.pausedMessage}
        postsHref={`/teams/${teamId}/projects/${projectId}/blogs/${blogId}/posts`}
        automationSettingsHref={`/teams/${teamId}/projects/${projectId}/blogs/${blogId}/settings#automation`}
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
