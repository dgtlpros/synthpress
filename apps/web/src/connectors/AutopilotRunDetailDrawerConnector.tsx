"use client";

import { AutopilotRunDetailDrawer } from "@/components/organisms/AutopilotRunDetailDrawer";
import { useAutopilotRunDetail } from "@/hooks/useAutopilotRunDetail";

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
  const { detail, isLoading, error } = useAutopilotRunDetail({
    teamId,
    projectId,
    blogId,
    runId,
  });

  return (
    <AutopilotRunDetailDrawer
      open={runId !== null}
      onClose={onClose}
      detail={detail}
      isLoading={isLoading}
      error={error}
      postsHref={postsHref}
      automationSettingsHref={automationSettingsHref}
    />
  );
}
