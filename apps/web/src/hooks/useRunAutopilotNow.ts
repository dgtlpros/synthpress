"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  runAutopilotNow,
  type RunAutopilotNowResult,
} from "@/actions/autopilot";
import type { BlogAutopilotPanelResult } from "@/components/organisms/BlogAutopilotPanel";

/**
 * Controller hook for the "Run Autopilot Now" button on the blog
 * settings page.
 *
 * Owns:
 *   * the in-flight flag the button uses for its spinner state
 *   * the result message the panel renders (success / error /
 *     informational "skipped" outcome)
 *   * the post-success `router.refresh()` that re-fetches the
 *     server-rendered recent-runs panel
 *
 * Does NOT own:
 *   * the autopilot-enabled gate — the panel decides whether to
 *     render the button as disabled. The hook still returns its
 *     handler unconditionally so the panel can short-circuit
 *     visually without a parallel "isDisabled" arg here.
 */

export interface UseRunAutopilotNowOptions {
  teamId: string;
  projectId: string;
  blogId: string;
  /** Fired with the action's success payload. */
  onSuccess?: (result: RunAutopilotNowResult) => void;
}

export interface UseRunAutopilotNowResult {
  run: () => void;
  isRunning: boolean;
  resultMessage: BlogAutopilotPanelResult | null;
  /** Last successful payload (handy for tests + future toasts). */
  lastResult: RunAutopilotNowResult | null;
  /** Clears the inline result message. */
  reset: () => void;
}

/**
 * Translate a raw scheduler outcome into the panel's inline copy.
 * Pure so tests can assert it without spinning up the hook.
 */
export function describeRunResult(
  result: RunAutopilotNowResult,
): BlogAutopilotPanelResult {
  if (result.status === "completed") {
    if (result.articleJobsStarted > 0 && result.ideasGenerated > 0) {
      return {
        kind: "success",
        message: `Autopilot generated ${result.ideasGenerated} ideas and started ${result.articleJobsStarted} article jobs.`,
      };
    }
    if (result.articleJobsStarted > 0) {
      return {
        kind: "success",
        message:
          result.articleJobsStarted === 1
            ? "Autopilot started 1 article job."
            : `Autopilot started ${result.articleJobsStarted} article jobs.`,
      };
    }
    if (result.ideasGenerated > 0) {
      return {
        kind: "success",
        message:
          result.ideasGenerated === 1
            ? "Autopilot generated 1 idea."
            : `Autopilot generated ${result.ideasGenerated} ideas.`,
      };
    }
    return {
      kind: "success",
      message: "Autopilot ran successfully.",
    };
  }

  if (result.status === "skipped") {
    return {
      kind: "success",
      message: result.reason
        ? `Autopilot skipped this run: ${result.reason}.`
        : "Autopilot skipped this run.",
    };
  }

  // failed
  return {
    kind: "error",
    message: result.reason
      ? `Autopilot failed: ${result.reason}.`
      : "Autopilot failed.",
  };
}

export function useRunAutopilotNow({
  teamId,
  projectId,
  blogId,
  onSuccess,
}: UseRunAutopilotNowOptions): UseRunAutopilotNowResult {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isRunning, setIsRunning] = useState(false);
  const [resultMessage, setResultMessage] =
    useState<BlogAutopilotPanelResult | null>(null);
  const [lastResult, setLastResult] =
    useState<RunAutopilotNowResult | null>(null);

  const run = useCallback(() => {
    setResultMessage(null);
    setIsRunning(true);
    startTransition(async () => {
      const result = await runAutopilotNow(teamId, projectId, blogId);
      if (result.error !== null) {
        setResultMessage({ kind: "error", message: result.error });
        setIsRunning(false);
        return;
      }
      setLastResult(result.data);
      setResultMessage(describeRunResult(result.data));
      setIsRunning(false);
      // Re-fetch the server-rendered panel so the new run shows up
      // in the recent-runs list. router.refresh() is the same
      // pattern the Generate Article hook uses on success.
      router.refresh();
      onSuccess?.(result.data);
    });
  }, [router, teamId, projectId, blogId, onSuccess]);

  const reset = useCallback(() => {
    setResultMessage(null);
  }, []);

  return { run, isRunning, resultMessage, lastResult, reset };
}
