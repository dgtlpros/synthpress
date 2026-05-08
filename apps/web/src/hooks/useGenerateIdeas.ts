"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  generateIdeasManual,
  type GenerateIdeasManualInput,
  type GenerateIdeasManualResult,
} from "@/actions/article-generation";

export interface UseGenerateIdeasOptions {
  teamId: string;
  projectId: string;
  blogId: string;
  /** Optional callback fired after a successful generation (UI may close a modal here). */
  onSuccess?: (result: GenerateIdeasManualResult) => void;
}

export interface UseGenerateIdeasResult {
  generate: (input?: GenerateIdeasManualInput) => void;
  isGenerating: boolean;
  generateError: string | null;
  /** Last successful result (handy for "ideas generated: N" toasts). */
  lastResult: GenerateIdeasManualResult | null;
  resetError: () => void;
}

/**
 * Controller hook for the manual "Generate ideas" flow.
 *
 * Calls the server action, owns the transient UI state (loading + error),
 * and refreshes the current route so the new ideas appear without a
 * full reload. The hook intentionally knows nothing about modals,
 * toasts, or where it's rendered — the connector composes that.
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
        router.refresh();
        onSuccess?.(result.data);
      });
    },
    [router, teamId, projectId, blogId, onSuccess],
  );

  return { generate, isGenerating, generateError, lastResult, resetError };
}
