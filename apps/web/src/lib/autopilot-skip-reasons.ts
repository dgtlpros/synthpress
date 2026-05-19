/**
 * Canonical autopilot run skip / completion `output.reason` strings.
 *
 * The scheduler stamps one of these on every run row's
 * `blog_autopilot_runs.output.reason`; the recent-runs panel + run
 * detail drawer render the value verbatim. Centralized here so:
 *
 *   * Test fixtures + UI surfaces import the same constant instead
 *     of sprinkling string literals (rename guard).
 *   * Future label/i18n maps have one list to switch on.
 *   * A grep for "what reasons can autopilot emit" lands here.
 *
 * Lives in `lib/` (no `server-only` import) because UI components
 * in the future may render labels keyed off these values. Today
 * the reason is rendered as a raw string, but the string set is
 * stable and worth pinning to a typed union.
 *
 * Naming convention: `<thing>_<state>` (snake_case). Verbs in the
 * past tense — these are stamped AFTER the gate fired
 * (`reached`, `disabled`, `empty`, `failed`).
 *
 * **Customer-facing vs. operational reasons.** Two of these
 * (`active_article_job_limit_reached`,
 * `active_team_article_job_limit_reached`) are internal MVP
 * operational throttles — backpressure language only. Daily-post
 * caps + token balance + per-blog `dailyTokenBudget` are the
 * customer-facing controls that gate how much autopilot is
 * allowed to do. Subscription / plan-tier caps do NOT exist in
 * MVP. See the per-reason JSDoc for the framing each one needs.
 */

export const AUTOPILOT_SKIP_REASONS = {
  /** Cron-loaded blog whose row was deleted between scan + tick. */
  BLOG_NOT_FOUND: "blog_not_found",

  /**
   * `settings.automation.mode !== 'autopilot'` OR
   * `settings.automation.enabled === false` at tick time. Manual
   * "Run autopilot now" hits this too if the user disarmed in
   * another tab between click + execute.
   */
  AUTOPILOT_DISABLED: "autopilot_disabled",

  /**
   * `getTeamPlan` returned `null` — the blog's owning team has no
   * billing record (deleted / mid-onboarding). We can't safely
   * spend tokens, so skip with a neutral reason.
   */
  TEAM_BILLING_UNAVAILABLE: "team_billing_unavailable",

  /** No work attempted because the run came in with `dryRun: true`. */
  DRY_RUN: "dry_run",

  /**
   * Backlog is below `backlogThreshold`, no approved ideas exist,
   * AND the team's token balance is below the idea-batch cost.
   * Distinguishes a money problem from a config problem.
   */
  INSUFFICIENT_BALANCE: "insufficient_balance",

  /**
   * Backlog is below threshold AND the per-blog
   * `dailyTokenBudget` doesn't have room for an idea batch (the
   * team balance might be fine — this is the per-blog ceiling).
   */
  BACKLOG_EMPTY_NO_BUDGET_FOR_IDEAS: "backlog_empty_no_budget_for_ideas",

  /**
   * Backlog count is at/above `backlogThreshold` (no idea top-up
   * fired) AND the approved-ideas list is empty. The "everything's
   * healthy, but human review hasn't approved anything yet" case.
   */
  NO_APPROVED_IDEAS_IN_BACKLOG: "no_approved_ideas_in_backlog",

  /**
   * `articlesStartedToday >= dailyMaxFromConfig`. Either
   * `maxPostsPerDay` or `ceil(generatePerWeek/7)` is the binding
   * limit. The cap is calendar-day local to the blog's
   * `automation.timezone` (or UTC when unset).
   *
   * Historical name kept (`*_cap_reached`) — pre-existing run rows
   * use this exact string and the spec is explicit that existing
   * data must keep reading correctly.
   */
  DAILY_ARTICLE_CAP_REACHED: "daily_article_cap_reached",

  /**
   * **Operational backpressure — NOT a product / subscription cap.**
   *
   * The blog already has the operational-throttle number of
   * `pending` / `processing` `generate_article` jobs in flight
   * (see `AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_BLOG`). Stops a
   * 15-minute cron tick from stacking jobs on top of jobs that
   * haven't finished yet.
   *
   * Surfacing posture for UI labels (when added later):
   *   * Title: "Autopilot is waiting for current article jobs to finish"
   *   * Body:  "This blog already has article jobs running, so
   *            autopilot will continue on the next scheduled run."
   *
   * Do NOT surface this as "you hit your plan limit" — daily post
   * counts are controlled by `automation.maxPostsPerDay` and the
   * team's Synth-token balance, not by this throttle.
   */
  ACTIVE_ARTICLE_JOB_LIMIT_REACHED: "active_article_job_limit_reached",

  /**
   * **Operational backpressure — NOT a subscription / plan-tier cap.**
   *
   * Sister gate to `active_article_job_limit_reached`, scoped
   * across every blog the team owns (see
   * `AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_TEAM`). Protects a
   * multi-blog project from saturating Anthropic / Pexels / the
   * Vercel Workflows queue.
   *
   * Same UI posture: backpressure language ("waiting for current
   * jobs"), not pricing / plan-cap language.
   */
  ACTIVE_TEAM_ARTICLE_JOB_LIMIT_REACHED:
    "active_team_article_job_limit_reached",

  /**
   * `articlesAllowedByTokens === 0` — the team balance OR the
   * per-blog `dailyTokenBudget` doesn't fit even a single article
   * cost. Distinct from `insufficient_balance` (which is the
   * "no backlog AND no idea budget" case).
   */
  INSUFFICIENT_TOKEN_BUDGET: "insufficient_token_budget",

  /**
   * Healthy fallback: nothing matched the more-specific branches.
   * The dashboard reads this as "tick was clean, no work to do".
   */
  NO_WORK_NEEDED: "no_work_needed",

  /** Run had work AND completed successfully — written by `completeBlogAutopilotRun`. */
  OK: "ok",

  /**
   * Some article workflows started + at least one threw during
   * queue/start. Run still counts as `completed` because partial
   * progress was made; `output.lastSpawnError` carries the
   * specific failure string.
   */
  PARTIAL_FAILURE: "partial_failure",

  /**
   * Idea generation step (Claude / network) failed. Run row's
   * status is `failed`; reason is surfaced for the recent-runs
   * panel.
   */
  IDEA_GENERATION_FAILED: "idea_generation_failed",
} as const;

export type AutopilotSkipReason =
  (typeof AUTOPILOT_SKIP_REASONS)[keyof typeof AUTOPILOT_SKIP_REASONS];

/**
 * Stable list — useful for tests + future UI label maps that want
 * to iterate every known reason exactly once.
 */
export const AUTOPILOT_SKIP_REASON_VALUES: readonly AutopilotSkipReason[] =
  Object.values(AUTOPILOT_SKIP_REASONS);
