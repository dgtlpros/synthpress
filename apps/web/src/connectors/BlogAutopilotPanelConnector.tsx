"use client";

import {
  BlogAutopilotPanel,
  type BlogAutopilotPanelProps,
} from "@/components/organisms/BlogAutopilotPanel";
import { useRunAutopilotNow } from "@/hooks/useRunAutopilotNow";

export interface BlogAutopilotPanelConnectorProps {
  teamId: string;
  projectId: string;
  blogId: string;
  blogName: string;
  /** `mode === "autopilot" && enabled === true`, computed server-side. */
  autopilotEnabled: boolean;
  /** URL of the Automation tab so the panel can deep-link disabled callers. */
  automationSettingsHref?: string;
  recentRuns: BlogAutopilotPanelProps["recentRuns"];
  /**
   * Auto-pause metadata read from `settings.automation`. The panel
   * uses these to render the "paused because runs failed" warning
   * banner. See {@link BlogAutopilotPanel} for the rendering rules.
   */
  pausedReason?: string | null;
  pausedAt?: string | null;
  pausedMessage?: string | null;
}

/**
 * Bridges the dumb {@link BlogAutopilotPanel} organism to the
 * {@link useRunAutopilotNow} hook. The settings page renders the
 * recent-runs list server-side and passes it through; the connector
 * only owns the button click + result message lifecycle.
 */
export function BlogAutopilotPanelConnector({
  teamId,
  projectId,
  blogId,
  blogName,
  autopilotEnabled,
  automationSettingsHref,
  recentRuns,
  pausedReason = null,
  pausedAt = null,
  pausedMessage = null,
}: BlogAutopilotPanelConnectorProps) {
  const { run, isRunning, resultMessage } = useRunAutopilotNow({
    teamId,
    projectId,
    blogId,
  });

  return (
    <BlogAutopilotPanel
      blogName={blogName}
      autopilotEnabled={autopilotEnabled}
      automationSettingsHref={automationSettingsHref}
      recentRuns={recentRuns}
      onRunNow={run}
      isRunning={isRunning}
      resultMessage={resultMessage}
      pausedReason={pausedReason}
      pausedAt={pausedAt}
      pausedMessage={pausedMessage}
    />
  );
}
