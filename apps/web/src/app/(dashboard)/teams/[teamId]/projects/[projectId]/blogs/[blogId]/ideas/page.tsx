import { notFound, redirect } from "next/navigation";
import {
  createClient,
  getAuthUserOncePerResponse,
} from "@/lib/supabase/server";
import { listArticleIdeasForBlog } from "@/services/article-generation-service";
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

  // Resolve article ids for converted ideas in one batch query so the
  // cards can render "View article" links without N+1 lookups.
  const convertedIdeaIds = ideas
    .filter((row) => row.status === "converted_to_article")
    .map((row) => row.id);
  const articleIdByIdea = await getArticleIdsByIdeaIds(
    convertedIdeaIds,
    supabase,
  );

  const blogBase = `/teams/${teamId}/projects/${projectId}/blogs/${blogId}`;

  const initialIdeas: IdeaCardIdea[] = ideas.map((row) => {
    const articleId = articleIdByIdea.get(row.id);
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
