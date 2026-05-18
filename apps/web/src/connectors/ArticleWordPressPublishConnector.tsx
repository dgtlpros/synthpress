"use client";

import {
  WordPressPublishCard,
  type WordPressArticleLocalStatus,
} from "@/components/molecules/WordPressPublishCard";
import { useWordPressPublish } from "@/hooks/useWordPressPublish";

export interface ArticleWordPressPublishConnectorProps {
  teamId: string;
  projectId: string;
  blogId: string;
  articleId: string;
  /** True iff the blog has WordPress credentials stored. */
  hasWordPressConnection: boolean;
  /** True iff the article has a non-empty Markdown body. */
  hasBody: boolean;
  /** Persisted WP post id (or null). */
  wpPostId: number | null;
  /** Persisted WP post URL (or null). */
  wpPostUrl: string | null;
  /**
   * Local article status (drives the published-live vs draft-sent
   * branching in the card).
   */
  articleStatus: WordPressArticleLocalStatus;
  /**
   * Featured image URL stored on the article (or null). Drives the
   * card's "Featured image will be uploaded…" / "Featured image
   * uploaded to WordPress" status line.
   */
  featuredImageUrl: string | null;
  /**
   * Cached WordPress media id for the featured image (or null).
   * `null` after a URL change → next sync uploads.
   */
  wpFeaturedMediaId: number | null;
  /** Where "Connect WordPress" links to. */
  connectionsHref: string;
}

/**
 * Bridges {@link useWordPressPublish} with the dumb
 * {@link WordPressPublishCard}. Lives next to the article detail
 * connector so the article page composes them as siblings.
 *
 * The connector is intentionally thin — it forwards the four
 * actions (send / updateDraft / publishLive / clearLink) through
 * to the card and translates the hook's `lastResult` into the
 * card's `justSent*` props so the success block renders without
 * waiting for `router.refresh()` to round-trip Supabase.
 */
export function ArticleWordPressPublishConnector({
  teamId,
  projectId,
  blogId,
  articleId,
  hasWordPressConnection,
  hasBody,
  wpPostId,
  wpPostUrl,
  articleStatus,
  featuredImageUrl,
  wpFeaturedMediaId,
  connectionsHref,
}: ArticleWordPressPublishConnectorProps) {
  const {
    send,
    updateDraft,
    publishLive,
    clearLink,
    isSending,
    isUpdating,
    isPublishing,
    isClearing,
    error,
    errorIsRemoteMissing,
    lastResult,
  } = useWordPressPublish({ teamId, projectId, blogId, articleId });

  return (
    <WordPressPublishCard
      hasConnection={hasWordPressConnection}
      hasBody={hasBody}
      wpPostId={wpPostId}
      wpPostUrl={wpPostUrl}
      articleStatus={articleStatus}
      connectionsHref={connectionsHref}
      onSend={send}
      onUpdateDraft={updateDraft}
      onPublishLive={publishLive}
      onClearLink={clearLink}
      isSending={isSending}
      isUpdating={isUpdating}
      isPublishing={isPublishing}
      isClearing={isClearing}
      errorMessage={error}
      errorIsRemoteMissing={errorIsRemoteMissing}
      justSentPostId={lastResult?.wpPostId ?? null}
      justSentPostUrl={lastResult?.wpPostUrl ?? null}
      featuredImageUrl={featuredImageUrl}
      wpFeaturedMediaId={wpFeaturedMediaId}
    />
  );
}
