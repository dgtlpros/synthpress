"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  generateArticleFromIdea,
  type GenerateArticleFromIdeaResult,
} from "@/actions/article-generation";

export interface UseGenerateArticleFromIdeaOptions {
  teamId: string;
  projectId: string;
  blogId: string;
  /** Fired with the result of a successful generation. */
  onSuccess?: (result: GenerateArticleFromIdeaResult) => void;
}

export interface UseGenerateArticleFromIdeaResult {
  generate: (ideaId: string) => void;
  /** Idea id of the in-flight generation, or null when idle. */
  pendingIdeaId: string | null;
  /** Idea id whose last generation errored, or null. */
  errorIdeaId: string | null;
  /** Last error message (paired with `errorIdeaId`). */
  errorMessage: string | null;
  /** Last successful result (handy for "view article" links / toasts). */
  lastResult: GenerateArticleFromIdeaResult | null;
  /** Clears any sticky error. */
  resetError: () => void;
}

/**
 * Controller hook for the manual "Generate article" action on an
 * approved idea card.
 *
 * Mirrors {@link useIdeaActions} so the connector can merge their
 * states (whichever idea is "busy" — being approved/rejected or
 * generated — wins, the others render disabled). The hook is
 * UI-agnostic: a future bulk "Generate from all approved" toolbar
 * would call `generate` in a loop.
 */
export function useGenerateArticleFromIdea({
  teamId,
  projectId,
  blogId,
  onSuccess,
}: UseGenerateArticleFromIdeaOptions): UseGenerateArticleFromIdeaResult {
  const router = useRouter();
  const [, startGenerate] = useTransition();
  const [pendingIdeaId, setPendingIdeaId] = useState<string | null>(null);
  const [errorIdeaId, setErrorIdeaId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastResult, setLastResult] =
    useState<GenerateArticleFromIdeaResult | null>(null);

  const generate = useCallback(
    (ideaId: string) => {
      setErrorIdeaId(null);
      setErrorMessage(null);
      setPendingIdeaId(ideaId);
      startGenerate(async () => {
        const result = await generateArticleFromIdea(
          teamId,
          projectId,
          blogId,
          ideaId,
        );
        if (result.error !== null) {
          setErrorIdeaId(ideaId);
          setErrorMessage(result.error);
          setPendingIdeaId(null);
          return;
        }
        setLastResult(result.data);
        router.refresh();
        setPendingIdeaId(null);
        onSuccess?.(result.data);
      });
    },
    [router, teamId, projectId, blogId, onSuccess],
  );

  const resetError = useCallback(() => {
    setErrorIdeaId(null);
    setErrorMessage(null);
  }, []);

  return {
    generate,
    pendingIdeaId,
    errorIdeaId,
    errorMessage,
    lastResult,
    resetError,
  };
}
