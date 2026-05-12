"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  clearArticleWordPressLink,
  publishArticleToWordPressLiveAction,
  sendArticleToWordPressDraft,
  type SendArticleToWordPressResult,
  type SyncArticleToWordPressResult,
  updateArticleWordPressDraftAction,
} from "@/actions/articles";
import { PUBLISH_ARTICLE_ERROR_COPY } from "@/lib/wordpress-publish-error-copy";

/**
 * Controller hook for the article detail page's WordPress panel.
 *
 * v1.1 surface:
 *   * `send`        — POST a brand-new draft (only valid when no
 *                     `wpPostId` exists yet)
 *   * `updateDraft` — PUT the existing draft (status="draft")
 *   * `publishLive` — PUT the existing post (status="publish") +
 *                     transition local article to `published`
 *   * `clearLink`   — null `wp_post_id`/`wp_post_url` so the user
 *                     can re-send as a brand-new draft
 *
 * State:
 *   * `pendingAction` — `null` when idle, otherwise the in-flight
 *     verb. The card uses this to decide which button shows the
 *     spinner.
 *   * `error` / `errorIsRemoteMissing` — the most recent failure;
 *     the boolean lets the card switch into the "remote draft
 *     missing" state without leaking the typed error code.
 *   * `lastResult` — payload from the most recent successful
 *     `send`/`updateDraft`/`publishLive` call. Stored so the
 *     success block doesn't flicker out before `router.refresh()`
 *     finishes.
 */

export type WordPressPublishAction = "send" | "update" | "publish" | "clear";

export interface UseWordPressPublishOptions {
  teamId: string;
  projectId: string;
  blogId: string;
  articleId: string;
  /** Fired with the freshly created/updated WP post details on success. */
  onSuccess?: (
    result: SendArticleToWordPressResult | SyncArticleToWordPressResult,
    action: Exclude<WordPressPublishAction, "clear">,
  ) => void;
}

export interface UseWordPressPublishResult {
  send: () => void;
  updateDraft: () => void;
  publishLive: () => void;
  clearLink: () => void;
  pendingAction: WordPressPublishAction | null;
  isSending: boolean;
  isUpdating: boolean;
  isPublishing: boolean;
  isClearing: boolean;
  error: string | null;
  errorIsRemoteMissing: boolean;
  lastResult:
    | (SendArticleToWordPressResult & { wpStatus?: "draft" | "publish" })
    | SyncArticleToWordPressResult
    | null;
  resetError: () => void;
}

/**
 * The friendly copy {@link PUBLISH_ARTICLE_ERROR_COPY} returns for
 * `wp_post_not_found`. We compare against this string to decide
 * whether to flip `errorIsRemoteMissing`. Comparing strings (rather
 * than threading an extra `code` field through the action result)
 * keeps the action's `ActionResult<T>` shape unchanged for callers
 * that don't care.
 */
const REMOTE_MISSING_COPY = PUBLISH_ARTICLE_ERROR_COPY.wp_post_not_found;

export function useWordPressPublish({
  teamId,
  projectId,
  blogId,
  articleId,
  onSuccess,
}: UseWordPressPublishOptions): UseWordPressPublishResult {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pendingAction, setPendingAction] =
    useState<WordPressPublishAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] =
    useState<UseWordPressPublishResult["lastResult"]>(null);

  /**
   * Generic dispatcher for the three WP-side actions. Centralises
   * pending/error/result state so the four exported callbacks stay
   * one-line wrappers — they exist mainly to give the card a clean
   * API and to let TypeScript narrow on the action label.
   */
  const runWpAction = useCallback(
    <T extends SendArticleToWordPressResult | SyncArticleToWordPressResult>(
      action: Exclude<WordPressPublishAction, "clear">,
      invoke: () => Promise<{ data: T | null; error: string | null }>,
    ) => {
      setError(null);
      setPendingAction(action);
      startTransition(async () => {
        const result = await invoke();
        if (result.error !== null) {
          setError(result.error);
          setPendingAction(null);
          return;
        }
        // Action contract: `error === null` implies `data !== null`.
        // The non-null assertion is safe per ActionResult<T>; if the
        // contract is ever violated the assertion will fail loudly
        // in dev rather than silently swallowing the success.
        const data = result.data!;
        setLastResult(data);
        router.refresh();
        setPendingAction(null);
        onSuccess?.(data, action);
      });
    },
    [router, onSuccess],
  );

  const send = useCallback(
    () =>
      runWpAction("send", () =>
        sendArticleToWordPressDraft(teamId, projectId, blogId, articleId),
      ),
    [runWpAction, teamId, projectId, blogId, articleId],
  );

  const updateDraft = useCallback(
    () =>
      runWpAction("update", () =>
        updateArticleWordPressDraftAction(teamId, projectId, blogId, articleId),
      ),
    [runWpAction, teamId, projectId, blogId, articleId],
  );

  const publishLive = useCallback(
    () =>
      runWpAction("publish", () =>
        publishArticleToWordPressLiveAction(
          teamId,
          projectId,
          blogId,
          articleId,
        ),
      ),
    [runWpAction, teamId, projectId, blogId, articleId],
  );

  const clearLink = useCallback(() => {
    setError(null);
    setPendingAction("clear");
    startTransition(async () => {
      const result = await clearArticleWordPressLink(
        teamId,
        projectId,
        blogId,
        articleId,
      );
      if (result.error !== null) {
        setError(result.error);
        setPendingAction(null);
        return;
      }
      // Clearing the local link wipes the success state — there's
      // no "Draft created" anymore, so the card should fall back
      // to the "ready to send" state.
      setLastResult(null);
      router.refresh();
      setPendingAction(null);
    });
  }, [router, teamId, projectId, blogId, articleId]);

  const resetError = useCallback(() => setError(null), []);

  return {
    send,
    updateDraft,
    publishLive,
    clearLink,
    pendingAction,
    isSending: pendingAction === "send",
    isUpdating: pendingAction === "update",
    isPublishing: pendingAction === "publish",
    isClearing: pendingAction === "clear",
    error,
    errorIsRemoteMissing: error === REMOTE_MISSING_COPY,
    lastResult,
    resetError,
  };
}
