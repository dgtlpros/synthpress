"use client";

import { useState } from "react";
import {
  BlogAutopilotPanel,
  type BlogAutopilotPanelProps,
} from "@/components/organisms/BlogAutopilotPanel";
import { AutopilotRunDetailDrawerConnector } from "@/connectors/AutopilotRunDetailDrawerConnector";
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
  /**
   * Prefix used by the detail drawer to compose "View article"
   * links — `${postsHref}/${articleId}`. Optional.
   */
  postsHref?: string;
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
 * {@link useRunAutopilotNow} hook AND the per-run
 * {@link AutopilotRunDetailDrawerConnector}.
 *
 * Click flow:
 *   1. User clicks a recent-run row.
 *   2. Panel fires `onRunSelect(runId)`.
 *   3. We stash the id in local state → drawer connector mounts
 *      with `runId !== null` → its hook fetches the detail.
 *   4. User closes → state clears → drawer goes back to "no run"
 *      (the hook resets its state too).
 */
export function BlogAutopilotPanelConnector({
  teamId,
  projectId,
  blogId,
  blogName,
  autopilotEnabled,
  automationSettingsHref,
  postsHref,
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
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  return (
    <>
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
        onRunSelect={setSelectedRunId}
      />
      <AutopilotRunDetailDrawerConnector
        teamId={teamId}
        projectId={projectId}
        blogId={blogId}
        runId={selectedRunId}
        onClose={() => setSelectedRunId(null)}
        postsHref={postsHref}
        automationSettingsHref={automationSettingsHref}
      />
    </>
  );
}
