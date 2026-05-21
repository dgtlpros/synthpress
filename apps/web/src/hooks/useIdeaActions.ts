"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  archiveIdea,
  type IdeaActionTargetStatus,
  unarchiveIdea,
  updateIdeaStatus,
} from "@/actions/article-generation";

export type { IdeaActionTargetStatus };

/**
 * Which action is in flight on a card. Mirrors the IdeaCard's
 * `pendingAction` enum so the connector can just pass this through
 * without a translation step.
 *
 *   * `"approved"` / `"rejected"`  — status updates
 *   * `"archiving"` / `"unarchiving"` — soft-delete toggles
 */
export type IdeaActionPending =
  | IdeaActionTargetStatus
  | "archiving"
  | "unarchiving";

export interface UseIdeaActionsOptions {
  teamId: string;
  projectId: string;
  blogId: string;
}

export interface UseIdeaActionsResult {
  approve: (ideaId: string) => void;
  reject: (ideaId: string) => void;
  archive: (ideaId: string) => void;
  unarchive: (ideaId: string) => void;
  /** Idea id of the in-flight action, or null when idle. */
  pendingIdeaId: string | null;
  /**
   * Which action is in flight, or null when idle. Approve/Reject use
   * the same status value the server action accepts; Archive/Unarchive
   * use distinct codes because they're orthogonal to lifecycle status.
   */
  pendingAction: IdeaActionPending | null;
  /**
   * @deprecated Read {@link pendingAction} instead. Kept as an alias
   * for back-compat with the v1 connector wiring; will be removed
   * once the connector is updated everywhere.
   */
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
 * Owns the "which idea is being approved/rejected/archived right
 * now" state, dispatches the server action, and refreshes the route
 * on success. The hook is deliberately UI-agnostic — the same hook
 * would back a future bulk-approve toolbar or a keyboard shortcut.
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
  const [pendingAction, setPendingAction] = useState<IdeaActionPending | null>(
    null,
  );
  const [errorIdeaId, setErrorIdeaId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const run = useCallback(
    (
      ideaId: string,
      action: IdeaActionPending,
      call: () => Promise<{ data: unknown; error: string | null }>,
    ) => {
      setErrorIdeaId(null);
      setErrorMessage(null);
      setPendingIdeaId(ideaId);
      setPendingAction(action);
      startUpdate(async () => {
        const result = await call();
        if (result.error !== null) {
          setErrorIdeaId(ideaId);
          setErrorMessage(result.error);
          setPendingIdeaId(null);
          setPendingAction(null);
          return;
        }
        router.refresh();
        setPendingIdeaId(null);
        setPendingAction(null);
      });
    },
    [router],
  );

  const resetError = useCallback(() => {
    setErrorIdeaId(null);
    setErrorMessage(null);
  }, []);

  const approve = useCallback(
    (ideaId: string) =>
      run(ideaId, "approved", () =>
        updateIdeaStatus(teamId, projectId, blogId, ideaId, "approved"),
      ),
    [run, teamId, projectId, blogId],
  );
  const reject = useCallback(
    (ideaId: string) =>
      run(ideaId, "rejected", () =>
        updateIdeaStatus(teamId, projectId, blogId, ideaId, "rejected"),
      ),
    [run, teamId, projectId, blogId],
  );
  const archive = useCallback(
    (ideaId: string) =>
      run(ideaId, "archiving", () =>
        archiveIdea(teamId, projectId, blogId, ideaId),
      ),
    [run, teamId, projectId, blogId],
  );
  const unarchive = useCallback(
    (ideaId: string) =>
      run(ideaId, "unarchiving", () =>
        unarchiveIdea(teamId, projectId, blogId, ideaId),
      ),
    [run, teamId, projectId, blogId],
  );

  // Back-compat: callers that still read `pendingStatus` (the v1
  // approve/reject-only field) get the approve/reject value when
  // applicable; archive/unarchive are silently absent so the legacy
  // discriminator keeps working.
  const pendingStatus: IdeaActionTargetStatus | null =
    pendingAction === "approved" || pendingAction === "rejected"
      ? pendingAction
      : null;

  return {
    approve,
    reject,
    archive,
    unarchive,
    pendingIdeaId,
    pendingAction,
    pendingStatus,
    errorIdeaId,
    errorMessage,
    resetError,
  };
}
