import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  createClient,
  getAuthUserOncePerResponse,
} from "@/lib/supabase/server";
import { getArticleByIdForBlog } from "@/services/article-service";
import { ArticleDetailConnector } from "@/connectors/ArticleDetailConnector";
import type { ArticleDetailData } from "@/components/organisms/ArticleDetail";
import type { PostStatus } from "@/components/atoms/PostStatusBadge";

export const dynamic = "force-dynamic";

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{
    teamId: string;
    projectId: string;
    blogId: string;
    articleId: string;
  }>;
}) {
  const { teamId, projectId, blogId, articleId } = await params;

  const {
    data: { user },
  } = await getAuthUserOncePerResponse();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // Verify the blog belongs to this project (RLS would filter the
  // article query too, but checking the chain explicitly gives us a
  // clean 404 instead of a silent empty result).
  // We also pull the WP credential columns so the publish card can
  // render its "connected / not connected" state without a second
  // request — we never expose the password to the client; we only
  // surface a boolean.
  const { data: blog } = await supabase
    .from("blogs")
    .select("id, name, wp_url, wp_username, wp_app_password")
    .eq("id", blogId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!blog) notFound();

  const article = await getArticleByIdForBlog(articleId, blogId, supabase);
  if (!article) notFound();

  const detail: ArticleDetailData = {
    id: article.id,
    title: article.title,
    slug: article.slug,
    status: article.status as PostStatus,
    excerpt: article.excerpt || null,
    metaDescription: article.meta_description,
    targetKeyword: article.target_keyword,
    contentMarkdown: article.content_markdown,
    wordCount: article.word_count,
    generatedByModel: article.generated_by_model ?? article.ai_model,
    errorMessage: article.error_message,
    updatedAt: article.updated_at,
    createdAt: article.created_at,
    wpPostId: article.wp_post_id,
    wpPostUrl: article.wp_post_url,
  };

  const hasWordPressConnection = Boolean(
    blog.wp_url && blog.wp_username && blog.wp_app_password,
  );
  const blogBase = `/teams/${teamId}/projects/${projectId}/blogs/${blogId}`;

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted" aria-label="Breadcrumb">
        <Link href={blogBase} className="hover:text-foreground">
          Posts
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span className="text-foreground">
          {detail.title || "Untitled article"}
        </span>
      </nav>

      <ArticleDetailConnector
        teamId={teamId}
        projectId={projectId}
        blogId={blogId}
        article={detail}
        hasWordPressConnection={hasWordPressConnection}
        connectionsHref={`${blogBase}/connections`}
      />
    </div>
  );
}
