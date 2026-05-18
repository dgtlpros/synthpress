"use client";

import { useCallback, useState, useTransition } from "react";
import { AutopilotRunDetailDrawer } from "@/components/organisms/AutopilotRunDetailDrawer";
import { useAutopilotRunDetail } from "@/hooks/useAutopilotRunDetail";
import { retryAutopilotWordPressDraftSend } from "@/actions/articles";

export interface AutopilotRunDetailDrawerConnectorProps {
  teamId: string;
  projectId: string;
  blogId: string;
  /** When non-null, the drawer is open and fetches that run's detail. */
  runId: string | null;
  onClose: () => void;
  /** Forwarded as the prefix for "View article" links. */
  postsHref?: string;
  /** Forwarded for the auto-paused warning's "Automation tab" link. */
  automationSettingsHref?: string;
}

/**
 * Bridges the {@link useAutopilotRunDetail} hook to the dumb
 * {@link AutopilotRunDetailDrawer} organism. The connector is the
 * only piece that depends on the server action — every layer below
 * it stays presentational so it can be storied / tested in
 * isolation.
 *
 * v12 adds the WordPress draft retry flow:
 *   * `useTransition` for the in-flight transition so click→fetch
 *     stays responsive even while React is committing the
 *     refetched detail tree.
 *   * `pendingJobId` tracks the single in-flight retry (UX: one
 *     retry at a time per drawer — see drawer prop docs).
 *   * `retryErrorByJobId` keeps per-row errors after a failed
 *     retry so the user can see the friendly copy without
 *     scrolling away.
 *   * On success we both call `refetch()` (drawer's detail) and
 *     `router.refresh()` is implicit via the action's
 *     `revalidatePath` calls (recent runs panel).
 */
export function AutopilotRunDetailDrawerConnector({
  teamId,
  projectId,
  blogId,
  runId,
  onClose,
  postsHref,
  automationSettingsHref,
}: AutopilotRunDetailDrawerConnectorProps) {
  const { detail, isLoading, error, refetch } = useAutopilotRunDetail({
    teamId,
    projectId,
    blogId,
    runId,
  });

  // Single in-flight retry. We intentionally do NOT allow
  // concurrent retries from the drawer — the dumb component
  // disables every other row's button while one is pending, and
  // the workflow is cheap enough that serializing is fine.
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [retryErrorByJobId, setRetryErrorByJobId] = useState<
    Record<string, string>
  >({});
  const [, startTransition] = useTransition();

  const handleRetry = useCallback(
    (jobId: string) => {
      /* v8 ignore start -- defensive: the drawer DOM-disables the
       * active row's button (loading=true ⇒ pointer-events-none) and
       * every sibling row's button (disabled=true when
       * retryingJobId !== job.id), so a real click can't re-enter
       * `handleRetry` while a retry is in flight. The guard exists
       * so a future caller (programmatic invoke, keyboard-bypassed
       * disable, etc.) still can't double-fire the action. Similarly,
       * `runId === null` only happens when the drawer is closed, and
       * the drawer is the only mount site for the retry buttons. */
      if (pendingJobId !== null) return;
      if (runId === null) return;
      /* v8 ignore stop */

      setPendingJobId(jobId);
      // Clear any prior error for this row before the new attempt
      // so the row stays clean during the spinner.
      setRetryErrorByJobId((prev) => {
        if (!(jobId in prev)) return prev;
        const next = { ...prev };
        delete next[jobId];
        return next;
      });

      startTransition(async () => {
        const result = await retryAutopilotWordPressDraftSend(
          teamId,
          projectId,
          blogId,
          runId,
          jobId,
        );
        if (result.error !== null) {
          setRetryErrorByJobId((prev) => ({ ...prev, [jobId]: result.error! }));
        } else {
          // Refetch the drawer's detail so the row reflects the
          // new `wpPublish` outcome + the Summary section's WP
          // counters pick up the rollup the service just wrote.
          refetch();
        }
        setPendingJobId(null);
      });
    },
    [blogId, pendingJobId, projectId, refetch, runId, teamId],
  );

  return (
    <AutopilotRunDetailDrawer
      open={runId !== null}
      onClose={onClose}
      detail={detail}
      isLoading={isLoading}
      error={error}
      postsHref={postsHref}
      automationSettingsHref={automationSettingsHref}
      onRetryWordPressDraft={handleRetry}
      retryingJobId={pendingJobId}
      retryErrorByJobId={retryErrorByJobId}
    />
  );
}
