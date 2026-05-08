"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  type IdeaActionTargetStatus,
  updateIdeaStatus,
} from "@/actions/article-generation";

export type { IdeaActionTargetStatus };

export interface UseIdeaActionsOptions {
  teamId: string;
  projectId: string;
  blogId: string;
}

export interface UseIdeaActionsResult {
  approve: (ideaId: string) => void;
  reject: (ideaId: string) => void;
  /** Idea id of the in-flight action, or null when idle. */
  pendingIdeaId: string | null;
  /** Which action is in flight, or null when idle. */
  pendingStatus: IdeaActionTargetStatus | null;
  /** Idea id whose last action errored, or null. */
  errorIdeaId: string | null;
  /** Last error message (paired with `errorIdeaId`). */
  errorMessage: string | null;
  /** Clears any sticky error so the next action starts fresh. */
  resetError: () => void;
}

/**
 * Controller hook for the idea-review actions on the Ideas page.
 *
 * Owns the "which idea is being approved/rejected right now" state,
 * dispatches the server action, and refreshes the route on success.
 * The hook is deliberately UI-agnostic — the same hook would back a
 * future bulk-approve toolbar or a keyboard shortcut.
 *
 * Single-action-at-a-time policy: the connector reads `pendingIdeaId`
 * and disables every other card's buttons while one is in flight.
 * v1's UI relies on that to keep the optimistic state easy to reason
 * about. The hook itself doesn't reject concurrent calls — that's a UI
 * concern.
 */
export function useIdeaActions({
  teamId,
  projectId,
  blogId,
}: UseIdeaActionsOptions): UseIdeaActionsResult {
  const router = useRouter();
  const [, startUpdate] = useTransition();
  const [pendingIdeaId, setPendingIdeaId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] =
    useState<IdeaActionTargetStatus | null>(null);
  const [errorIdeaId, setErrorIdeaId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const update = useCallback(
    (ideaId: string, status: IdeaActionTargetStatus) => {
      setErrorIdeaId(null);
      setErrorMessage(null);
      setPendingIdeaId(ideaId);
      setPendingStatus(status);
      startUpdate(async () => {
        const result = await updateIdeaStatus(
          teamId,
          projectId,
          blogId,
          ideaId,
          status,
        );
        if (result.error !== null) {
          setErrorIdeaId(ideaId);
          setErrorMessage(result.error);
          setPendingIdeaId(null);
          setPendingStatus(null);
          return;
        }
        router.refresh();
        setPendingIdeaId(null);
        setPendingStatus(null);
      });
    },
    [router, teamId, projectId, blogId],
  );

  const resetError = useCallback(() => {
    setErrorIdeaId(null);
    setErrorMessage(null);
  }, []);

  const approve = useCallback(
    (ideaId: string) => update(ideaId, "approved"),
    [update],
  );
  const reject = useCallback(
    (ideaId: string) => update(ideaId, "rejected"),
    [update],
  );

  return {
    approve,
    reject,
    pendingIdeaId,
    pendingStatus,
    errorIdeaId,
    errorMessage,
    resetError,
  };
}
