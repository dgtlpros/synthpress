import { notFound, redirect } from "next/navigation";
import {
  createClient,
  getAuthUserOncePerResponse,
} from "@/lib/supabase/server";
import {
  getActiveGenerateArticleIdeaIds,
  listArticleIdeasForBlog,
} from "@/services/article-generation-service";
import { getArticleIdsByIdeaIds } from "@/services/article-service";
import { getCreditCost } from "@/lib/ai/config";
import { IDEA_DEFAULT_COUNT } from "@/lib/ai/provider";
import { IdeasListConnector } from "@/connectors/IdeasListConnector";
import type { IdeaCardIdea } from "@/components/molecules/IdeaCard";
import type { IdeaStatus } from "@/components/atoms/IdeaStatusBadge";

export const dynamic = "force-dynamic";

export default async function BlogIdeasPage({
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
    .select("id")
    .eq("id", blogId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!blog) notFound();

  const ideas = await listArticleIdeasForBlog(blogId, supabase);

  // Resolve article ids for both converted ideas (so "View article"
  // links work) AND for ideas with an in-flight workflow (the article
  // placeholder exists with status = `generating` — let the user click
  // through to watch the empty article fill in).
  //
  // We also query "which approved ideas have an active generation
  // job" so the card can render a persisted "Generating…" badge that
  // survives a page refresh.
  const approvedIdeaIds = ideas
    .filter((row) => row.status === "approved")
    .map((row) => row.id);
  const convertedIdeaIds = ideas
    .filter((row) => row.status === "converted_to_article")
    .map((row) => row.id);

  const [activeGeneratingIdeaIds, articleIdByIdea] = await Promise.all([
    getActiveGenerateArticleIdeaIds(blogId, approvedIdeaIds, supabase),
    getArticleIdsByIdeaIds([...convertedIdeaIds, ...approvedIdeaIds], supabase),
  ]);

  const blogBase = `/teams/${teamId}/projects/${projectId}/blogs/${blogId}`;

  const initialIdeas: IdeaCardIdea[] = ideas.map((row) => {
    const articleId = articleIdByIdea.get(row.id);
    const isGenerating = activeGeneratingIdeaIds.has(row.id);
    return {
      id: row.id,
      title: row.title,
      status: row.status as IdeaStatus,
      targetKeyword: row.target_keyword,
      executiveSummary: row.executive_summary,
      articleType: row.article_type,
      estimatedWordCount: row.estimated_word_count,
      createdAt: row.created_at,
      viewArticleHref: articleId ? `${blogBase}/posts/${articleId}` : null,
      isGenerating,
    };
  });

  return (
    <IdeasListConnector
      teamId={teamId}
      projectId={projectId}
      blogId={blogId}
      initialIdeas={initialIdeas}
      defaultCount={IDEA_DEFAULT_COUNT}
      creditsCost={getCreditCost("generateIdeas")}
    />
  );
}
