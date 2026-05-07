"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPost } from "@/actions/workspace";

export interface UseBlogPostsOptions {
  teamId: string;
  projectId: string;
  blogId: string;
}

export interface UseBlogPostsResult {
  createPost: (input: { title: string }) => void;
  isCreating: boolean;
  createError: string | null;
}

export function useBlogPosts({
  teamId,
  projectId,
  blogId,
}: UseBlogPostsOptions): UseBlogPostsResult {
  const router = useRouter();
  const [isCreating, startCreate] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);

  const create = useCallback(
    (input: { title: string }) => {
      setCreateError(null);
      startCreate(async () => {
        const result = await createPost(teamId, projectId, blogId, input);
        if (result.error) {
          setCreateError(result.error);
          return;
        }
        router.refresh();
      });
    },
    [router, teamId, projectId, blogId],
  );

  return { createPost: create, isCreating, createError };
}
