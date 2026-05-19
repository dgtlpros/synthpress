import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatAutopilotSkipReason } from "@/lib/autopilot-skip-reason-labels";
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
  /**
   * WordPress draft auto-send counters. Rolled up from per-job
   * `output.wpPublish` by `syncAutopilotRunWordPressDraftCounters`.
   * All default to 0 when no autopilot WP-draft attempts happened
   * (or when the autopilot blog isn't configured to auto-send).
   * The metric line below only renders WP fields when
   * `wpDraftsExpected > 0`, so legacy runs stay visually clean.
   */
  wpDraftsExpected: number;
  wpDraftsCreated: number;
  wpDraftsAlreadySent: number;
  wpDraftsSkipped: number;
  wpDraftsFailed: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AutopilotRunRowProps extends Omit<
  HTMLAttributes<HTMLLIElement>,
  "onSelect"
> {
  run: AutopilotRunRowData;
  /**
   * Fires when the user activates the row. When provided, the row's
   * inner content is wrapped in a `<button>` so it's keyboard-
   * accessible and announces "View details for run X". When omitted,
   * the row stays presentational (used by the storybook + the
   * fallback case where a connector hasn't wired the click through).
   *
   * `Omit`ed from the base HTMLAttributes because `<li>` carries a
   * native `onSelect` event handler with a different signature; ours
   * takes the run id, not a SyntheticEvent.
   */
  onSelect?: (runId: string) => void;
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

function readReason(output: Record<string, unknown> | null): string | null {
  if (!output) return null;
  const reason = output.reason;
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

/**
 * Reads the auto-approved counter the autopilot scheduler stamps
 * on `output` when `requireReview === false`. Returns `0` when the
 * field is missing (older runs) or non-numeric (corrupt jsonb).
 */
function readAutoApprovedCount(output: Record<string, unknown> | null): number {
  if (!output) return 0;
  const v = output.ideasAutoApproved;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
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
  onSelect,
  ...props
}: AutopilotRunRowProps) {
  const stepLabel = formatStep(run.currentStep);
  const triggerLabel = formatTriggerSource(run.triggerSource);
  const jobCount = spawnedJobsCount(run.output);
  const reason = readReason(run.output);
  // Resolve the friendly label / description from the raw reason
  // key. The raw key stays in `output.reason` for grep + analysis;
  // this helper is the presentation layer. Operational throttle
  // reasons get backpressure-flavored copy here (NOT plan-cap
  // language); see `autopilot-skip-reason-labels.ts`.
  const reasonCopy = formatAutopilotSkipReason(reason);
  const autoApprovedCount = readAutoApprovedCount(run.output);

  // Only show the secondary metric line when there's something to
  // show. Keeps quiet "skipped, nothing to do" runs from looking
  // visually identical to busy "5 articles started" runs.
  const hasCounters =
    run.ideasGenerated > 0 ||
    autoApprovedCount > 0 ||
    run.articlesStarted > 0 ||
    run.articlesCompleted > 0 ||
    run.articlesFailed > 0 ||
    run.tokensSpent > 0 ||
    run.tokensRefunded > 0 ||
    run.wpDraftsExpected > 0;
  const wpDraftSummary = buildWpDraftSummary(run);

  // The full body of the row — same content regardless of
  // clickability; just rendered inside a <button> when onSelect
  // is wired so the whole row is keyboard-accessible.
  const body = (
    <div className="flex flex-col gap-1.5">
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
          {autoApprovedCount > 0 ? (
            <span>{autoApprovedCount} auto-approved</span>
          ) : null}
          {run.articlesStarted > 0 ? (
            <span>{run.articlesStarted} article jobs started</span>
          ) : null}
          {run.articlesCompleted > 0 ? (
            <span>{run.articlesCompleted} completed</span>
          ) : null}
          {run.articlesFailed > 0 ? (
            <span className="text-error">{run.articlesFailed} failed</span>
          ) : null}
          {run.tokensSpent > 0 ? (
            <span>{run.tokensSpent} tokens spent</span>
          ) : null}
          {run.tokensRefunded > 0 ? (
            <span className="text-warning">{run.tokensRefunded} refunded</span>
          ) : null}
          {wpDraftSummary ? (
            <span
              className={wpDraftSummary.tone}
              data-testid={`autopilot-run-${run.id}-wp-draft-summary`}
            >
              {wpDraftSummary.text}
            </span>
          ) : null}
        </p>
      ) : null}

      {jobCount !== null && jobCount > 0 && run.articlesStarted === 0 ? (
        // Fallback when the counter row didn't already cover it
        // (shouldn't happen in practice but the data could disagree
        // if a future feature stamps spawnedArticleJobIds without
        // the `articlesStarted` increment).
        <p className="text-xs text-muted">{jobCount} article jobs started</p>
      ) : null}

      {run.errorMessage ? (
        // role isn't used inside a button (announce-on-render is wrong
        // for a click target). Fall back to a plain <span> so the
        // alert role only surfaces on the standalone variant.
        onSelect ? (
          <span className="line-clamp-2 text-xs text-error">
            {run.errorMessage}
          </span>
        ) : (
          <p className="line-clamp-2 text-xs text-error" role="alert">
            {run.errorMessage}
          </p>
        )
      ) : null}

      {reason && !run.errorMessage && reasonCopy.label ? (
        // Friendly label first; the (optional) description sits on
        // its own line as muted subtext so the row stays scannable.
        // The raw `reason` key is intentionally not surfaced here —
        // operators who need it can open the detail drawer's "Raw
        // run output" section.
        <div
          className="text-xs text-muted"
          data-testid={`autopilot-run-${run.id}-reason`}
          data-reason-key={reason}
          data-reason-tone={reasonCopy.tone}
        >
          <p>
            <span className="font-medium text-foreground">Reason:</span>{" "}
            {reasonCopy.label}
          </p>
          {reasonCopy.description ? (
            <p className="text-[11px] text-muted/80">
              {reasonCopy.description}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <li
      className={cn(
        "text-sm",
        "border-b border-border last:border-b-0",
        // The button owns padding when present; otherwise the li does.
        onSelect ? null : "px-3 py-2.5",
        className,
      )}
      {...props}
    >
      {onSelect ? (
        <button
          type="button"
          onClick={() => onSelect(run.id)}
          aria-label={`View details for autopilot run ${run.id}`}
          className="block w-full px-3 py-2.5 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-blue"
        >
          {body}
        </button>
      ) : (
        body
      )}
    </li>
  );
}

/**
 * Single-line summary of the four `wp_drafts_*` counters for the
 * recent-runs metric row. Returns `null` when nothing was
 * attempted (wpDraftsExpected === 0) so legacy / non-autopilot
 * runs render no WP fragment.
 *
 * Wording priority (most useful signal first):
 *   * Any failures              → "N/M WordPress drafts created · K failed"
 *                                  or "K WordPress drafts failed" when
 *                                  nothing succeeded.
 *   * None created + some skipped due to no connection
 *                                → "WordPress not connected"
 *   * Otherwise, join the
 *     created / already-sent pair → "N WordPress drafts created · K already sent"
 *
 * `tone` is the Tailwind text-color token to apply — errors stay
 * red, warnings stay amber, success stays muted (the metric line's
 * default).
 *
 * Invariant (held by `syncAutopilotRunWordPressDraftCounters`):
 *   expected = created + alreadySent + skipped + failed
 * — so "expected > 0 with all four buckets at 0" is impossible
 * in practice; we don't bother handling it.
 */
function buildWpDraftSummary(
  run: AutopilotRunRowData,
): { text: string; tone: string } | null {
  if (run.wpDraftsExpected <= 0) return null;

  if (run.wpDraftsFailed > 0) {
    if (run.wpDraftsCreated === 0) {
      return {
        text: `${run.wpDraftsFailed} WordPress drafts failed`,
        tone: "text-error",
      };
    }
    return {
      text: `${run.wpDraftsCreated}/${run.wpDraftsExpected} WordPress drafts created · ${run.wpDraftsFailed} failed`,
      tone: "text-error",
    };
  }

  // No failures. If nothing was created but some were skipped due
  // to a missing connection, lead with that — it's actionable.
  if (run.wpDraftsCreated === 0 && run.wpDraftsSkipped > 0) {
    return { text: "WordPress not connected", tone: "text-warning" };
  }

  // Some combination of created + already_sent, no failures.
  const parts: string[] = [];
  if (run.wpDraftsCreated > 0) {
    parts.push(`${run.wpDraftsCreated} WordPress drafts created`);
  }
  if (run.wpDraftsAlreadySent > 0) {
    parts.push(`${run.wpDraftsAlreadySent} already sent`);
  }
  /* v8 ignore next 3 -- invariant guarantees parts.length > 0 here; defensive only */
  if (parts.length === 0) return null;
  return { text: parts.join(" · "), tone: "text-muted" };
}
