import { notFound, redirect } from "next/navigation";
import {
  createClient,
  getAuthUserOncePerResponse,
} from "@/lib/supabase/server";
import { BlogPostsConnector } from "@/connectors/BlogPostsConnector";
import { listPostsForBlog } from "@/services/workspace-service";
import type { PostsDashboardPost } from "@/components/organisms/PostsDashboard";
import type { PostStatus } from "@/components/atoms/PostStatusBadge";

export const dynamic = "force-dynamic";

export default async function BlogPostsPage({
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
    .select("id, wp_url")
    .eq("id", blogId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!blog) notFound();

  const articles = await listPostsForBlog(blogId, supabase);

  const destinationLabel = blog.wp_url
    ? `WordPress (${stripScheme(blog.wp_url)})`
    : null;

  const posts: PostsDashboardPost[] = articles.map((a) => ({
    id: a.id,
    title: a.title,
    status: a.status as PostStatus,
    targetKeyword: a.target_keyword,
    authorPersona: a.author_persona,
    wordCount: a.word_count,
    scheduledAt: a.scheduled_at,
    publishedAt: a.published_at,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    destinationLabel: a.wp_post_url
      ? `WordPress (${stripScheme(a.wp_post_url)})`
      : destinationLabel,
  }));

  return (
    <BlogPostsConnector
      teamId={teamId}
      projectId={projectId}
      blogId={blogId}
      initialPosts={posts}
    />
  );
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
