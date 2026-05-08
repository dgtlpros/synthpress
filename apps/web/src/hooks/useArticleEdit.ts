"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateArticle, type UpdateArticleResult } from "@/actions/articles";
import type { ArticleEditableFields } from "@/services/article-service";

/**
 * Form value the edit UI mirrors. Same shape as the service input but
 * collapses optional nullable fields to plain strings — the form
 * always renders a controlled `<input>` / `<textarea>` and we convert
 * empty strings to null at the action boundary.
 */
export interface ArticleEditFormValue {
  title: string;
  slug: string;
  excerpt: string;
  metaDescription: string;
  targetKeyword: string;
  contentMarkdown: string;
}

export interface UseArticleEditOptions {
  teamId: string;
  projectId: string;
  blogId: string;
  articleId: string;
  initialValue: ArticleEditFormValue;
  /** Fired with the new server-side status after a successful save. */
  onSaved?: (result: UpdateArticleResult) => void;
}

export interface UseArticleEditResult {
  value: ArticleEditFormValue;
  setField: <K extends keyof ArticleEditFormValue>(
    key: K,
    value: ArticleEditFormValue[K],
  ) => void;
  isEditing: boolean;
  enterEdit: () => void;
  cancelEdit: () => void;
  save: () => void;
  isSaving: boolean;
  saveError: string | null;
  resetSaveError: () => void;
}

function toFields(value: ArticleEditFormValue): ArticleEditableFields {
  // Collapse blanks → null at the boundary so the DB sees a clean
  // distinction between "user cleared this field" and "this field never
  // had a value".
  const trim = (s: string) => s.trim();
  return {
    title: value.title,
    slug: trim(value.slug) || null,
    excerpt: trim(value.excerpt) || null,
    metaDescription: trim(value.metaDescription) || null,
    targetKeyword: trim(value.targetKeyword) || null,
    contentMarkdown: trim(value.contentMarkdown) || null,
  };
}

/**
 * Controller hook for the article detail page's edit mode.
 *
 * Owns:
 *   * `isEditing` — toggles between read view + edit form
 *   * the form `value` (controlled inputs)
 *   * pending + error state for the save server action
 *
 * Resets the form `value` to `initialValue` on cancel — important so
 * a "click Edit, type stuff, hit Cancel, click Edit again" cycle
 * starts from the canonical server state, not the user's last typing.
 */
export function useArticleEdit({
  teamId,
  projectId,
  blogId,
  articleId,
  initialValue,
  onSaved,
}: UseArticleEditOptions): UseArticleEditResult {
  const router = useRouter();
  const [, startSave] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [value, setValue] = useState<ArticleEditFormValue>(initialValue);
  const [saveError, setSaveError] = useState<string | null>(null);

  const setField = useCallback(
    <K extends keyof ArticleEditFormValue>(
      key: K,
      next: ArticleEditFormValue[K],
    ) => {
      setValue((prev) => ({ ...prev, [key]: next }));
    },
    [],
  );

  const enterEdit = useCallback(() => {
    setSaveError(null);
    setValue(initialValue);
    setIsEditing(true);
  }, [initialValue]);

  const cancelEdit = useCallback(() => {
    setSaveError(null);
    setValue(initialValue);
    setIsEditing(false);
  }, [initialValue]);

  const save = useCallback(() => {
    setSaveError(null);
    setIsSaving(true);
    startSave(async () => {
      const result = await updateArticle(
        teamId,
        projectId,
        blogId,
        articleId,
        toFields(value),
      );
      if (result.error !== null) {
        setSaveError(result.error);
        setIsSaving(false);
        return;
      }
      router.refresh();
      setIsEditing(false);
      setIsSaving(false);
      onSaved?.(result.data);
    });
  }, [router, teamId, projectId, blogId, articleId, value, onSaved]);

  const resetSaveError = useCallback(() => setSaveError(null), []);

  return {
    value,
    setField,
    isEditing,
    enterEdit,
    cancelEdit,
    save,
    isSaving,
    saveError,
    resetSaveError,
  };
}
