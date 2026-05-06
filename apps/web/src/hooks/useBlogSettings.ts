"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteBlog, updateBlog } from "@/actions/workspace";

export interface UseBlogSettingsOptions {
  teamId: string;
  projectId: string;
  blogId: string;
}

export interface UseBlogSettingsResult {
  renameBlog: (name: string) => void;
  isRenamingBlog: boolean;
  renameError: string | null;

  deleteBlog: () => void;
  isDeletingBlog: boolean;
  deleteError: string | null;
}

export function useBlogSettings({
  teamId,
  projectId,
  blogId,
}: UseBlogSettingsOptions): UseBlogSettingsResult {
  const router = useRouter();

  const [isRenamingBlog, startRename] = useTransition();
  const [renameError, setRenameError] = useState<string | null>(null);

  const [isDeletingBlog, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const renameBlog = useCallback(
    (name: string) => {
      setRenameError(null);
      startRename(async () => {
        const result = await updateBlog(teamId, projectId, blogId, { name });
        if (result.error) {
          setRenameError(result.error);
          return;
        }
        router.refresh();
      });
    },
    [router, teamId, projectId, blogId],
  );

  const deleteBlogFn = useCallback(() => {
    setDeleteError(null);
    startDelete(async () => {
      const result = await deleteBlog(teamId, projectId, blogId);
      if (result.error) {
        setDeleteError(result.error);
        return;
      }
      router.push(
        result.data?.redirect ?? `/teams/${teamId}/projects/${projectId}/blogs`,
      );
    });
  }, [router, teamId, projectId, blogId]);

  return {
    renameBlog,
    isRenamingBlog,
    renameError,
    deleteBlog: deleteBlogFn,
    isDeletingBlog,
    deleteError,
  };
}
