import {
  AUTOPILOT_SKIP_REASONS,
  type AutopilotSkipReason,
} from "./autopilot-skip-reasons";

/**
 * Friendly labels + descriptions for autopilot run reasons.
 *
 * The scheduler stamps raw snake_case keys (e.g.
 * `daily_article_cap_reached`) on `blog_autopilot_runs.output.reason`
 * — see `autopilot-skip-reasons.ts` for the canonical list. Those
 * keys are great for grep / data analysis but unfit for the recent-
 * runs panel and the run detail drawer. This module is the
 * presentation layer for them.
 *
 * Why a `lib/` module (not part of the constants file):
 *   * Keeps `autopilot-skip-reasons.ts` purely the data layer (the
 *     scheduler imports the constants module without dragging copy
 *     into the server bundle).
 *   * Lets the UI surfaces (`AutopilotRunRow`,
 *     `AutopilotRunDetailDrawer`) share one source of truth for
 *     wording so renames stay in sync.
 *   * Future i18n: this module is where a `useTranslation` hook
 *     would slot in without touching the scheduler.
 *
 * **MVP language posture (operational vs. customer-facing).**
 *   * `daily_article_cap_reached` / `insufficient_token_budget` /
 *     `insufficient_balance` describe customer-facing limits the
 *     user can act on. Copy is direct and informational.
 *   * `active_article_job_limit_reached` /
 *     `active_team_article_job_limit_reached` describe internal
 *     operational throttles. Copy uses BACKPRESSURE language
 *     ("Autopilot is waiting for current jobs to finish") and
 *     deliberately avoids any words that imply a paywall, plan
 *     cap, subscription tier, or upgrade requirement. The unit
 *     tests in `autopilot-skip-reason-labels.test.ts` regex-guard
 *     against `plan|subscription|tier|pricing|upgrade|paywall`
 *     leaking into either string.
 *
 * Storage contract:
 *   The `blog_autopilot_runs.output.reason` column keeps storing
 *   the raw snake_case key. UI surfaces resolve the friendly copy
 *   on the read path. That preserves grep / data analysis ergonomics
 *   AND lets us iterate on UI copy without a migration.
 */

/**
 * Tone hint for downstream surfaces (badges, alert colors). Pure
 * presentation classification — not stored anywhere.
 *
 *   * `success`  — happy-path completion (`ok`).
 *   * `warning`  — actionable for the user (top up tokens, drop a
 *                  manual idea, fix billing).
 *   * `danger`   — failure or misconfiguration the system can't
 *                  recover from on its own (`idea_generation_failed`,
 *                  `blog_not_found`).
 *   * `default`  — informational / "no work needed" / waiting. The
 *                  active-job throttles are explicitly `default`,
 *                  not `warning`, because they don't ask the user
 *                  to do anything.
 */
export type AutopilotSkipReasonTone =
  | "default"
  | "success"
  | "warning"
  | "danger";

interface ReasonCopy {
  label: string;
  description: string | null;
  tone: AutopilotSkipReasonTone;
}

/**
 * Per-reason wording. Keys are the snake_case `output.reason`
 * values from {@link AUTOPILOT_SKIP_REASONS}; the helper functions
 * below all read through this map.
 *
 * NOTE on operational throttle copy (do NOT change without
 * matching the regex guard in
 * `autopilot-skip-reason-labels.test.ts`): the strings for
 * `active_article_job_limit_reached` and
 * `active_team_article_job_limit_reached` are deliberately
 * backpressure-flavored. They must not reference plans /
 * subscriptions / tiers / pricing / upgrades / paywalls.
 */
const REASON_COPY: Record<string, ReasonCopy> = {
  [AUTOPILOT_SKIP_REASONS.OK]: {
    label: "Completed",
    description: null,
    tone: "success",
  },
  [AUTOPILOT_SKIP_REASONS.PARTIAL_FAILURE]: {
    label: "Completed with issues",
    description: "Some work completed, but one or more steps had issues.",
    tone: "warning",
  },
  [AUTOPILOT_SKIP_REASONS.DAILY_ARTICLE_CAP_REACHED]: {
    label: "Daily article target reached",
    description:
      "This blog has already started the configured number of article jobs for today.",
    tone: "default",
  },
  [AUTOPILOT_SKIP_REASONS.ACTIVE_ARTICLE_JOB_LIMIT_REACHED]: {
    label: "Autopilot is waiting for current article jobs to finish",
    description:
      "This blog already has article jobs running, so autopilot will continue on the next scheduled run.",
    tone: "default",
  },
  [AUTOPILOT_SKIP_REASONS.ACTIVE_TEAM_ARTICLE_JOB_LIMIT_REACHED]: {
    label: "Autopilot is waiting for team article jobs to finish",
    description:
      "This team already has article jobs running across its blogs, so autopilot will continue on the next scheduled run.",
    tone: "default",
  },
  [AUTOPILOT_SKIP_REASONS.NO_APPROVED_IDEAS_IN_BACKLOG]: {
    label: "No approved ideas available",
    description:
      "Autopilot needs approved ideas before it can generate articles.",
    tone: "default",
  },
  [AUTOPILOT_SKIP_REASONS.BACKLOG_EMPTY_NO_BUDGET_FOR_IDEAS]: {
    label: "No approved ideas and no idea budget",
    description:
      "Autopilot could not generate new ideas because the token budget was not available.",
    tone: "warning",
  },
  [AUTOPILOT_SKIP_REASONS.IDEA_GENERATION_FAILED]: {
    label: "Idea generation failed",
    description: "Autopilot could not generate new ideas for this run.",
    tone: "danger",
  },
  [AUTOPILOT_SKIP_REASONS.INSUFFICIENT_BALANCE]: {
    label: "Insufficient token balance",
    description: "The team does not have enough Synth tokens to continue.",
    tone: "warning",
  },
  [AUTOPILOT_SKIP_REASONS.INSUFFICIENT_TOKEN_BUDGET]: {
    label: "Daily token budget reached",
    description: "This blog has reached its configured daily token budget.",
    tone: "default",
  },
  [AUTOPILOT_SKIP_REASONS.NO_WORK_NEEDED]: {
    label: "No work needed",
    description: "Autopilot checked this blog and found nothing new to do.",
    tone: "default",
  },
  [AUTOPILOT_SKIP_REASONS.AUTOPILOT_DISABLED]: {
    label: "Autopilot disabled",
    description: "Autopilot is not currently enabled for this blog.",
    tone: "default",
  },
  [AUTOPILOT_SKIP_REASONS.DRY_RUN]: {
    label: "Dry run completed",
    description: "Autopilot simulated the run without starting jobs.",
    tone: "default",
  },
  [AUTOPILOT_SKIP_REASONS.TEAM_BILLING_UNAVAILABLE]: {
    label: "Billing unavailable",
    description: "Autopilot could not verify the team's token balance.",
    tone: "warning",
  },
  [AUTOPILOT_SKIP_REASONS.BLOG_NOT_FOUND]: {
    label: "Blog not found",
    description: "Autopilot could not find the blog for this run.",
    tone: "danger",
  },
};

/**
 * Title-cases a snake_case string so an unknown future reason
 * still renders as something readable instead of leaking the raw
 * key.
 *
 *   "midjourney_cap_reached" → "Midjourney Cap Reached"
 *
 * The transform is intentionally simple — it doesn't try to
 * hyphenate or strip the trailing `_reached`/`_failed` suffix
 * because doing so would lose information the operator might want
 * (e.g. "*_skipped" is meaningfully different from "*_failed").
 * When we add a new known reason we update {@link REASON_COPY};
 * this fallback is for the gap between deploy windows.
 */
function snakeToTitleCase(reason: string): string {
  return reason
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Looks up the friendly label for a reason key. Returns:
 *
 *   * known reason → its mapped label
 *   * unknown non-empty reason → snake_case → Title Case fallback
 *   * `null` / `undefined` / empty / whitespace string → `null`
 *     (callers render no label rather than blank chrome)
 */
export function getAutopilotSkipReasonLabel(
  reason: string | null | undefined,
): string | null {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (trimmed.length === 0) return null;
  const known = REASON_COPY[trimmed];
  if (known) return known.label;
  return snakeToTitleCase(trimmed);
}

/**
 * Looks up the friendly description for a reason key.
 *
 *   * known reason → its mapped description (which may be `null`
 *     intentionally, e.g. `ok`)
 *   * unknown non-empty reason → `null` (we don't fabricate copy
 *     for keys we haven't reviewed)
 *   * `null` / `undefined` / empty / whitespace → `null`
 */
export function getAutopilotSkipReasonDescription(
  reason: string | null | undefined,
): string | null {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (trimmed.length === 0) return null;
  const known = REASON_COPY[trimmed];
  if (known) return known.description;
  return null;
}

export interface FormattedAutopilotSkipReason {
  /** Friendly label or title-cased fallback. `null` when input is empty/null. */
  label: string | null;
  /** Friendly description. `null` for unknown / no-description reasons. */
  description: string | null;
  /**
   * Tone hint for badges / alert colors. Defaults to `"default"`
   * for unknown reasons (we don't assume failure on a key we
   * haven't classified).
   */
  tone: AutopilotSkipReasonTone;
}

/**
 * One-shot helper that returns label + description + tone in a
 * single call. Surfaces use this when they need all three (e.g.
 * the run detail drawer renders the description AND tints the
 * section based on tone). Equivalent to calling the two helpers
 * separately + reading the tone from the same map.
 */
export function formatAutopilotSkipReason(
  reason: string | null | undefined,
): FormattedAutopilotSkipReason {
  if (typeof reason !== "string") {
    return { label: null, description: null, tone: "default" };
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return { label: null, description: null, tone: "default" };
  }
  const known = REASON_COPY[trimmed];
  if (known) {
    return {
      label: known.label,
      description: known.description,
      tone: known.tone,
    };
  }
  return {
    label: snakeToTitleCase(trimmed),
    description: null,
    tone: "default",
  };
}

/**
 * Sanity export so tests can lock in "every known reason has a
 * non-empty label" without re-importing the constant module.
 * Returns the keys we have copy for (NOT the canonical reason
 * list — that's `AUTOPILOT_SKIP_REASON_VALUES`).
 */
export function getKnownAutopilotSkipReasons(): readonly AutopilotSkipReason[] {
  return Object.keys(REASON_COPY) as AutopilotSkipReason[];
}
