"use client";

import { useState } from "react";
import { Button } from "@/components/atoms/Button";
import { DeleteConfirmModal } from "@/components/atoms/DeleteConfirmModal";
import { Input } from "@/components/atoms/Input";
import { useBlogSettings } from "@/hooks/useBlogSettings";

export interface BlogSettingsConnectorProps {
  teamId: string;
  projectId: string;
  blogId: string;
  blogName: string;
}

export function BlogSettingsConnector({
  teamId,
  projectId,
  blogId,
  blogName,
}: BlogSettingsConnectorProps) {
  const blog = useBlogSettings({ teamId, projectId, blogId });

  const [renameOpen, setRenameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(blogName);
  const [deleteOpen, setDeleteOpen] = useState(false);

  function handleRename() {
    blog.renameBlog(nameDraft);
    if (!blog.renameError) setRenameOpen(false);
  }

  /* v8 ignore start */
  const renameSection = renameOpen ? (
    <div className="flex items-center gap-2">
      <Input
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        disabled={blog.isRenamingBlog}
        autoFocus
        autoComplete="off"
        aria-label="Blog name"
        className="max-w-xs"
      />
      <Button
        type="button"
        size="sm"
        loading={blog.isRenamingBlog}
        onClick={handleRename}
      >
        Save
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={blog.isRenamingBlog}
        onClick={() => {
          setNameDraft(blogName);
          setRenameOpen(false);
        }}
      >
        Cancel
      </Button>
    </div>
  ) : (
    <div className="flex items-center gap-3">
      <p role="heading" aria-level={1} className="text-2xl font-bold text-foreground">{blogName}</p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => {
          setNameDraft(blogName);
          setRenameOpen(true);
        }}
      >
        Rename
      </Button>
    </div>
  );
  /* v8 ignore stop */

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {renameSection}
        {blog.renameError ? (
          <p className="mt-1 text-sm text-error" role="alert">
            {blog.renameError}
          </p>
        ) : null}
        {blog.deleteError ? (
          <p className="mt-1 text-sm text-error" role="alert">
            {blog.deleteError}
          </p>
        ) : null}
      </div>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        loading={blog.isDeletingBlog}
        onClick={() => setDeleteOpen(true)}
        className="shrink-0 self-start text-error hover:bg-error/10 border border-error/30"
      >
        Delete blog app
      </Button>

      <DeleteConfirmModal
        open={deleteOpen}
        entityKind="blog app"
        requiredPhrase={blogName}
        loading={blog.isDeletingBlog}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => blog.deleteBlog()}
      />
    </div>
  );
}
