"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  generateIdeasManual,
  type GenerateIdeasManualInput,
  type GenerateIdeasManualResult,
} from "@/actions/article-generation";
import { dispatchJobQueuedEvent } from "@/lib/active-jobs";

export interface UseGenerateIdeasOptions {
  teamId: string;
  projectId: string;
  blogId: string;
  /**
   * Fired after the queue + workflow start round-trip succeeds (UI
   * may close the modal here). The argument carries the durable job
   * id and `alreadyQueued` so the modal can show a different toast
   * for "already running" vs "just started".
   */
  onSuccess?: (result: GenerateIdeasManualResult) => void;
}

export interface UseGenerateIdeasResult {
  generate: (input?: GenerateIdeasManualInput) => void;
  /** True while the queue + workflow start round-trip is in flight. */
  isGenerating: boolean;
  generateError: string | null;
  /** Last successful queue/start result. */
  lastResult: GenerateIdeasManualResult | null;
  resetError: () => void;
}

/**
 * Controller hook for the manual "Generate ideas" flow.
 *
 * Mirrors {@link useGenerateArticleFromIdea} now that ideas use the
 * same queue + Vercel Workflow architecture as article generation:
 *
 *   * Calls the server action (which queues the durable job + starts
 *     the workflow).
 *   * The server action returns IMMEDIATELY — we don't await Claude.
 *   * On success, fires {@link dispatchJobQueuedEvent} so the global
 *     active-jobs tray refetches RIGHT NOW (without waiting for the
 *     ~8s poll), then `router.refresh()` to nudge any server
 *     components that read `article_jobs` directly.
 *   * On error, surfaces the message — the modal stays open so the
 *     user can fix the input and retry.
 *
 * The hook intentionally knows nothing about modals, toasts, or
 * where it's rendered — the connector composes that.
 */
export function useGenerateIdeas({
  teamId,
  projectId,
  blogId,
  onSuccess,
}: UseGenerateIdeasOptions): UseGenerateIdeasResult {
  const router = useRouter();
  const [isGenerating, startGenerate] = useTransition();
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [lastResult, setLastResult] =
    useState<GenerateIdeasManualResult | null>(null);

  const resetError = useCallback(() => setGenerateError(null), []);

  const generate = useCallback(
    (input?: GenerateIdeasManualInput) => {
      setGenerateError(null);
      startGenerate(async () => {
        const result = await generateIdeasManual(
          teamId,
          projectId,
          blogId,
          input ?? {},
        );
        if (result.error !== null) {
          setGenerateError(result.error);
          return;
        }
        setLastResult(result.data);
        // Nudge the global active-jobs tray to refetch right now so
        // the new "Queued" / "Generating ideas…" row appears
        // immediately instead of waiting up to one polling interval.
        // Idempotent — dispatching is cheap and only fires the
        // tray's listener.
        dispatchJobQueuedEvent({
          jobId: result.data.jobId,
          // Generate ideas jobs don't have an article id; the event
          // detail tolerates `null` for forward-compat with future
          // job types that aren't article-bound.
          articleId: null,
        });
        router.refresh();
        onSuccess?.(result.data);
      });
    },
    [router, teamId, projectId, blogId, onSuccess],
  );

  return { generate, isGenerating, generateError, lastResult, resetError };
}
