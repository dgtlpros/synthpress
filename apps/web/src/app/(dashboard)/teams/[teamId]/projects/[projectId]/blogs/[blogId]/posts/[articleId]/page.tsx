import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  createClient,
  getAuthUserOncePerResponse,
} from "@/lib/supabase/server";
import { getArticleByIdForBlog } from "@/services/article-service";
import {
  getActiveImageUploadForArticle,
  listSectionImageRowsForArticle,
} from "@/services/article-image-upload-service";
import { ArticleDetailConnector } from "@/connectors/ArticleDetailConnector";
import type {
  ArticleDetailData,
  ArticleFeaturedImageAttribution,
} from "@/components/organisms/ArticleDetail";
import type { MarkdownPreviewSectionImage } from "@/components/atoms/MarkdownPreview";
import type { PostStatus } from "@/components/atoms/PostStatusBadge";
import type { InitialSectionImage } from "@/hooks/useArticleEdit";

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

  // Active attribution row for the current featured image (the
  // latest `article_image_uploads` row whose `image_url` matches
  // `featured_image_url`). Read with the user's RLS-bound client so
  // a member-of-the-blog check happens automatically. Null when the
  // image was manually pasted (no row) or no featured image is set.
  const attributionRow = await getActiveImageUploadForArticle(
    articleId,
    article.featured_image_url,
    supabase,
  );

  const featuredImageAttribution: ArticleFeaturedImageAttribution | null =
    attributionRow
      ? {
          provider: attributionRow.provider,
          photographerName: attributionRow.photographer_name,
          photographerProfileUrl: attributionRow.photographer_profile_url,
          photoUrl: attributionRow.photo_url,
        }
      : null;

  // Section-image rows for the article body. Same RLS-bound client
  // so a non-member of the blog gets an empty list (not an
  // unauthorized error). We project two related shapes:
  //   * `sectionImagesByKey` — the renderer map for
  //     `MarkdownPreview.sectionImagesByKey`. Keyed by `section_key`
  //     so the H2 renderer can look up by document position.
  //   * `initialSectionImages` — the controller-hook seed list
  //     (carries `sortOrder` so the editor renders slots in the
  //     same order as the body). The connector forwards it to
  //     `useArticleEdit`.
  const sectionRows = await listSectionImageRowsForArticle(
    articleId,
    supabase,
  );
  const sectionImagesByKey: Record<string, MarkdownPreviewSectionImage> = {};
  const initialSectionImages: InitialSectionImage[] = [];
  for (const row of sectionRows) {
    if (!row.section_key) continue;
    sectionImagesByKey[row.section_key] = {
      imageUrl: row.image_url,
      altText: row.alt_text,
      attribution:
        row.photographer_name || row.photographer_profile_url || row.photo_url
          ? {
              provider: row.provider,
              photographerName: row.photographer_name,
              photographerProfileUrl: row.photographer_profile_url,
              photoUrl: row.photo_url,
            }
          : null,
    };
    initialSectionImages.push({
      sectionKey: row.section_key,
      sectionHeading: row.section_heading ?? "",
      sortOrder: row.sort_order,
      imageUrl: row.image_url,
      altText: row.alt_text,
    });
  }

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
    featuredImageUrl: article.featured_image_url,
    featuredImageAlt: article.featured_image_alt,
    wpFeaturedMediaId: article.wp_featured_media_id,
    featuredImageAttribution,
    sectionImagesByKey,
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
        initialSectionImages={initialSectionImages}
        hasWordPressConnection={hasWordPressConnection}
        connectionsHref={`${blogBase}/connections`}
      />
    </div>
  );
}
