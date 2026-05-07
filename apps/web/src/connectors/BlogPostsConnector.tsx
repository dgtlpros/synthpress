"use client";

import { useRouter } from "next/navigation";
import {
  PostsDashboard,
  type PostsDashboardPost,
} from "@/components/organisms/PostsDashboard";
import { useBlogPosts } from "@/hooks/useBlogPosts";

export interface BlogPostsConnectorProps {
  teamId: string;
  projectId: string;
  blogId: string;
  initialPosts: PostsDashboardPost[];
}

export function BlogPostsConnector({
  teamId,
  projectId,
  blogId,
  initialPosts,
}: BlogPostsConnectorProps) {
  const router = useRouter();
  const { createPost, isCreating, createError } = useBlogPosts({
    teamId,
    projectId,
    blogId,
  });

  return (
    <div className="space-y-4">
      {createError ? (
        <p className="text-sm text-error" role="alert">
          {createError}
        </p>
      ) : null}
      <PostsDashboard
        posts={initialPosts}
        onCreatePost={createPost}
        isCreating={isCreating}
        onPostClick={(postId) =>
          router.push(
            `/teams/${teamId}/projects/${projectId}/blogs/${blogId}/posts/${postId}`,
          )
        }
      />
    </div>
  );
}
