import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import {
  AutopilotRunStatusBadge,
  type AutopilotRunStatus,
} from "@/components/atoms/AutopilotRunStatusBadge";

/**
 * Display shape for one row in the recent autopilot runs panel.
 * Mirrors `blog_autopilot_runs` minus the columns the panel doesn't
 * show (project_id, team_id — already known by the page that
 * mounts the panel).
 */
export interface AutopilotRunRowData {
  id: string;
  status: AutopilotRunStatus;
  triggerSource: string;
  currentStep: string | null;
  errorMessage: string | null;
  /** Free-form `output` jsonb. Read for `reason` + `spawnedArticleJobIds`. */
  output: Record<string, unknown> | null;
  ideasGenerated: number;
  articlesStarted: number;
  articlesCompleted: number;
  articlesFailed: number;
  tokensSpent: number;
  tokensRefunded: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AutopilotRunRowProps extends HTMLAttributes<HTMLLIElement> {
  run: AutopilotRunRowData;
}

const TRIGGER_SOURCE_LABELS: Record<string, string> = {
  cron: "Scheduled",
  manual: "Manual",
  workflow: "Workflow",
  system: "System",
};

const STEP_LABELS: Record<string, string> = {
  loading_settings: "Loading settings",
  checking_budget: "Checking budget",
  checking_backlog: "Checking backlog",
  generating_ideas: "Generating ideas",
  generating_articles: "Generating articles",
  completed: "Completed",
};

function formatStep(step: string | null): string | null {
  if (!step) return null;
  return STEP_LABELS[step] ?? step;
}

function formatTriggerSource(source: string): string {
  return TRIGGER_SOURCE_LABELS[source] ?? source;
}

/**
 * Friendly relative-time formatter ("just now", "5m ago", "3h ago",
 * "2d ago", or the locale date when older). Identical algorithm to
 * the `IdeaCard` row time stamp; keeps the panel's chronology
 * scannable without the noise of a full timestamp.
 */
function relativeTime(iso: string | null): string {
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

function spawnedJobsCount(
  output: Record<string, unknown> | null,
): number | null {
  if (!output) return null;
  const ids = output.spawnedArticleJobIds;
  if (!Array.isArray(ids)) return null;
  return ids.length;
}

function readReason(
  output: Record<string, unknown> | null,
): string | null {
  if (!output) return null;
  const reason = output.reason;
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

/**
 * One row in the recent autopilot runs panel. Dumb molecule —
 * receives a row, renders the status badge + trigger + counters +
 * (when present) the failure / skip reason. Layout is intentionally
 * compact: the recent-runs panel needs to fit alongside the
 * Automation tab without dominating the page.
 */
export function AutopilotRunRow({
  run,
  className,
  ...props
}: AutopilotRunRowProps) {
  const stepLabel = formatStep(run.currentStep);
  const triggerLabel = formatTriggerSource(run.triggerSource);
  const jobCount = spawnedJobsCount(run.output);
  const reason = readReason(run.output);

  // Only show the secondary metric line when there's something to
  // show. Keeps quiet "skipped, nothing to do" runs from looking
  // visually identical to busy "5 articles started" runs.
  const hasCounters =
    run.ideasGenerated > 0 ||
    run.articlesStarted > 0 ||
    run.articlesCompleted > 0 ||
    run.articlesFailed > 0 ||
    run.tokensSpent > 0 ||
    run.tokensRefunded > 0;

  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 px-3 py-2.5 text-sm",
        "border-b border-border last:border-b-0",
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <AutopilotRunStatusBadge status={run.status} />
            <span className="text-xs text-muted">{triggerLabel}</span>
            <span className="text-xs text-muted">·</span>
            <span className="text-xs text-muted">
              {relativeTime(run.completedAt ?? run.createdAt)}
            </span>
          </div>
          {stepLabel ? (
            <p className="truncate text-xs text-muted">
              <span className="font-medium text-foreground">Step:</span>{" "}
              {stepLabel}
            </p>
          ) : null}
        </div>
      </div>

      {hasCounters ? (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          {run.ideasGenerated > 0 ? (
            <span>{run.ideasGenerated} ideas generated</span>
          ) : null}
          {run.articlesStarted > 0 ? (
            <span>{run.articlesStarted} article jobs started</span>
          ) : null}
          {run.articlesCompleted > 0 ? (
            <span>{run.articlesCompleted} completed</span>
          ) : null}
          {run.articlesFailed > 0 ? (
            <span className="text-error">
              {run.articlesFailed} failed
            </span>
          ) : null}
          {run.tokensSpent > 0 ? (
            <span>{run.tokensSpent} tokens spent</span>
          ) : null}
          {run.tokensRefunded > 0 ? (
            <span className="text-warning">
              {run.tokensRefunded} refunded
            </span>
          ) : null}
        </p>
      ) : null}

      {jobCount !== null && jobCount > 0 && run.articlesStarted === 0 ? (
        // Fallback when the counter row didn't already cover it
        // (shouldn't happen in practice but the data could disagree
        // if a future feature stamps spawnedArticleJobIds without
        // the `articlesStarted` increment).
        <p className="text-xs text-muted">
          {jobCount} article jobs started
        </p>
      ) : null}

      {run.errorMessage ? (
        <p
          className="line-clamp-2 text-xs text-error"
          role="alert"
        >
          {run.errorMessage}
        </p>
      ) : null}

      {reason && !run.errorMessage ? (
        <p className="text-xs text-muted">
          <span className="font-medium text-foreground">Reason:</span>{" "}
          {reason}
        </p>
      ) : null}
    </li>
  );
}
