"use client";

import {
  ArticleDetail,
  type ArticleDetailData,
} from "@/components/organisms/ArticleDetail";
import { ArticleEditForm } from "@/components/organisms/ArticleEditForm";
import {
  type ArticleEditFormValue,
  useArticleEdit,
} from "@/hooks/useArticleEdit";

export interface ArticleDetailConnectorProps {
  teamId: string;
  projectId: string;
  blogId: string;
  article: ArticleDetailData;
}

/**
 * Bridges the read-view + edit-form organisms with the
 * {@link useArticleEdit} hook. Read mode shows {@link ArticleDetail}
 * with an Edit button; edit mode shows {@link ArticleEditForm} with
 * Save / Cancel.
 *
 * The page (server component) hands us the article in `ArticleDetailData`
 * shape; we derive the editor's initial form value from the same
 * source so a Cancel always returns to the canonical server state.
 */
export function ArticleDetailConnector({
  teamId,
  projectId,
  blogId,
  article,
}: ArticleDetailConnectorProps) {
  const initialValue: ArticleEditFormValue = {
    title: article.title,
    slug: article.slug ?? "",
    excerpt: article.excerpt ?? "",
    metaDescription: article.metaDescription ?? "",
    targetKeyword: article.targetKeyword ?? "",
    contentMarkdown: article.contentMarkdown ?? "",
  };

  const {
    value,
    setField,
    isEditing,
    enterEdit,
    cancelEdit,
    save,
    isSaving,
    saveError,
  } = useArticleEdit({
    teamId,
    projectId,
    blogId,
    articleId: article.id,
    initialValue,
  });

  if (isEditing) {
    return (
      <ArticleEditForm
        value={value}
        onChange={setField}
        onCancel={cancelEdit}
        onSubmit={save}
        isSaving={isSaving}
        errorMessage={saveError}
      />
    );
  }

  return <ArticleDetail article={article} onEdit={enterEdit} />;
}
