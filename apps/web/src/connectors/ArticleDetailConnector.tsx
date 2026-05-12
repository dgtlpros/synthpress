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
import { ArticleWordPressPublishConnector } from "./ArticleWordPressPublishConnector";

export interface ArticleDetailConnectorProps {
  teamId: string;
  projectId: string;
  blogId: string;
  article: ArticleDetailData;
  /**
   * True iff the blog has all three WordPress credential fields
   * stored. Computed in the parent server component so we don't
   * re-query Supabase from the client.
   */
  hasWordPressConnection: boolean;
  /**
   * Where the publish card's "Connect WordPress" link points —
   * typically `${blogBase}/connections`.
   */
  connectionsHref: string;
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
 *
 * Below the read view we also mount the WordPress publish card. We
 * deliberately do NOT render the publish card while the user is
 * actively editing — the card mutates the same article row through
 * a different action and the UX is cleaner if "Send to WordPress"
 * is only available on the saved version.
 */
export function ArticleDetailConnector({
  teamId,
  projectId,
  blogId,
  article,
  hasWordPressConnection,
  connectionsHref,
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

  return (
    <div className="space-y-6">
      <ArticleDetail article={article} onEdit={enterEdit} />
      <ArticleWordPressPublishConnector
        teamId={teamId}
        projectId={projectId}
        blogId={blogId}
        articleId={article.id}
        hasWordPressConnection={hasWordPressConnection}
        hasBody={Boolean(
          article.contentMarkdown && article.contentMarkdown.trim(),
        )}
        wpPostId={article.wpPostId}
        wpPostUrl={article.wpPostUrl}
        articleStatus={article.status}
        connectionsHref={connectionsHref}
      />
    </div>
  );
}
