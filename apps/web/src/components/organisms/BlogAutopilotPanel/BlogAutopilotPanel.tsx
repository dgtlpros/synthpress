import { type HTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Button } from "@/components/atoms/Button";
import { Card } from "@/components/atoms/Card";
import {
  AutopilotRunRow,
  type AutopilotRunRowData,
} from "@/components/molecules/AutopilotRunRow";

/**
 * Panel that lives on the blog settings page (or wherever else the
 * caller drops it). Two halves:
 *
 *   1. A "Run Autopilot Now" header with the manual-trigger button
 *      and (when present) an inline result/error message.
 *   2. A scrollable recent-runs list, populated from
 *      `blog_autopilot_runs` by the page that mounts this panel.
 *
 * The panel is dumb — every callback is hoisted to the connector.
 * Disabled state (`autopilotEnabled=false`) gates the button + shows
 * helper copy that links the user to the Automation tab.
 */

export interface BlogAutopilotPanelProps extends HTMLAttributes<HTMLElement> {
  /** Display name of the blog — used in the "Run autopilot for X" copy. */
  blogName: string;
  /**
   * `true` when `settings.automation.mode === "autopilot"` AND
   * `settings.automation.enabled === true`. The button is disabled
   * + replaced with helper text otherwise.
   */
  autopilotEnabled: boolean;
  /**
   * URL of the Automation tab so the helper text can link the user
   * to where they enable autopilot. Optional — when omitted the
   * helper text is plain.
   */
  automationSettingsHref?: string;
  /** Recent `blog_autopilot_runs` rows, newest-first. */
  recentRuns: AutopilotRunRowData[];
  /**
   * Fired when the user clicks the Run button. The connector wires
   * this to the `runAutopilotNow` server action.
   */
  onRunNow?: () => void;
  /** True while the action is in flight. Drives the spinner state. */
  isRunning?: boolean;
  /**
   * Inline message rendered below the button.
   *   * `null`        — nothing to show
   *   * `{ kind: "success", message }`  — green helper text
   *   * `{ kind: "error",   message }`  — red helper text (role=alert)
   */
  resultMessage?: BlogAutopilotPanelResult | null;
  /**
   * Set when the autopilot scheduler auto-paused this blog (currently
   * only `"failure_rate"`). Drives the warning banner that explains
   * *why* autopilot is disabled, distinguishing it from a normal
   * user-disabled state. Comes straight from
   * `settings.automation.pausedReason`.
   */
  pausedReason?: string | null;
  /** ISO timestamp of when the auto-pause was recorded. */
  pausedAt?: string | null;
  /** Human copy for the warning banner. */
  pausedMessage?: string | null;
  /**
   * Fires when the user activates a recent-run row. The connector
   * uses this to open the {@link AutopilotRunDetailDrawerConnector}.
   * Optional — when omitted, rows render as static (used in
   * Storybook).
   */
  onRunSelect?: (runId: string) => void;
}

export type BlogAutopilotPanelResult =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

/**
 * Friendly relative-time formatter ("just now", "5m ago", …) for the
 * paused-banner timestamp. Local copy of the same algorithm
 * `AutopilotRunRow` uses — keeps this molecule self-contained.
 */
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 14 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function BlogAutopilotPanel({
  blogName,
  autopilotEnabled,
  automationSettingsHref,
  recentRuns,
  onRunNow,
  isRunning = false,
  resultMessage = null,
  pausedReason = null,
  pausedAt = null,
  pausedMessage = null,
  onRunSelect,
  className,
  ...props
}: BlogAutopilotPanelProps) {
  // Show the warning banner *only* when the scheduler paused us.
  // A user-toggled disabled state still falls through to the gray
  // "Open the Automation tab…" note below.
  const showPausedWarning =
    !autopilotEnabled && pausedReason === "failure_rate";
  const pausedAtLabel = relativeTime(pausedAt);
  return (
    <Card className={cn("space-y-4", className)} {...props}>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Autopilot</h2>
          <p className="mt-1 text-sm text-muted">
            Trigger a one-off autopilot tick for{" "}
            <span className="font-medium text-foreground">{blogName}</span>{" "}
            without waiting for the next scheduled run.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={onRunNow}
          loading={isRunning}
          disabled={!autopilotEnabled || isRunning || !onRunNow}
        >
          Run Autopilot Now
        </Button>
      </header>

      {showPausedWarning ? (
        <div
          className="rounded-[var(--sp-radius-md)] border border-warning/40 bg-warning/10 p-3 text-xs text-warning"
          role="alert"
          data-testid="autopilot-paused-warning"
        >
          <p className="font-semibold">
            Autopilot was paused because multiple recent runs failed.
          </p>
          <p className="mt-1 text-warning/90">
            {pausedMessage ??
              "Review recent runs, then re-enable autopilot when you\u2019re ready."}
          </p>
          <p className="mt-2 text-warning/80">
            {pausedAtLabel ? <>Paused {pausedAtLabel}. </> : null}
            Re-enable autopilot from the{" "}
            {automationSettingsHref ? (
              <Link
                href={automationSettingsHref}
                className="font-medium underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
              >
                Automation tab
              </Link>
            ) : (
              <span className="font-medium">Automation tab</span>
            )}{" "}
            once you&apos;ve reviewed the failures below.
          </p>
        </div>
      ) : !autopilotEnabled ? (
        <p
          className="rounded-[var(--sp-radius-md)] border border-border bg-surface-hover p-3 text-xs text-muted"
          role="note"
        >
          Autopilot is disabled. Open the{" "}
          {automationSettingsHref ? (
            <Link
              href={automationSettingsHref}
              className="font-medium text-brand-blue hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
            >
              Automation tab
            </Link>
          ) : (
            <span className="font-medium text-foreground">Automation tab</span>
          )}
          , set Mode to Autopilot, and turn on the Enabled toggle to run it
          here.
        </p>
      ) : null}

      {resultMessage ? (
        <p
          className={cn(
            "rounded-[var(--sp-radius-md)] border p-3 text-xs",
            resultMessage.kind === "success"
              ? "border-success/30 bg-success/10 text-success"
              : "border-error/30 bg-error/10 text-error",
          )}
          role={resultMessage.kind === "error" ? "alert" : "status"}
        >
          {resultMessage.message}
        </p>
      ) : null}

      <div>
        <h3 className="text-sm font-semibold text-foreground">Recent runs</h3>
        <p className="mt-0.5 text-xs text-muted">
          The last few autopilot ticks for this blog. Updated when the page
          reloads.
        </p>
        {recentRuns.length === 0 ? (
          <p className="mt-3 rounded-[var(--sp-radius-md)] border border-dashed border-border p-4 text-center text-xs text-muted">
            No autopilot runs yet. The first scheduled tick (or a Run Autopilot
            Now click) will land here.
          </p>
        ) : (
          <ul
            aria-label="Recent autopilot runs"
            className="mt-3 max-h-[24rem] overflow-y-auto rounded-[var(--sp-radius-md)] border border-border"
          >
            {recentRuns.map((run) => (
              <AutopilotRunRow key={run.id} run={run} onSelect={onRunSelect} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
