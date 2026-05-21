import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { start } from "workflow/api";
import { loadBlogSettings } from "@/lib/blog-settings";
import { getCreditCost } from "@/lib/ai/config";
import { AUTOPILOT_SKIP_REASONS } from "@/lib/autopilot-skip-reasons";
import { getTeamPlan } from "./team-billing-service";
import {
  type ArticleIdeaRow,
  type ArticleIdeaStatus,
  countUsableIdeasForBacklog,
  generateArticleIdeas,
  queueGenerateArticleFromIdea,
} from "./article-generation-service";
import {
  type BlogAutopilotRunTriggerSource,
  completeBlogAutopilotRun,
  createBlogAutopilotRun,
  failBlogAutopilotRun,
  updateBlogAutopilotRunStatus,
} from "./blog-autopilot-run-service";
import { generateArticleWorkflow } from "@/workflows/generate-article";

/**
 * Autopilot v1.
 *
 * The job of this module is to take blogs whose owner has explicitly
 * armed autopilot (`settings.automation.mode === "autopilot"` AND
 * `settings.automation.enabled === true`) and:
 *
 *   1. Top up their approved-idea backlog when it dips below
 *      `settings.automation.backlogThreshold`.
 *   2. Spawn `generate_article` workflows from approved ideas, capped
 *      by the blog's daily/weekly limits, the team's token balance,
 *      and an optional per-blog `dailyTokenBudget`.
 *
 * Important constraints:
 *   * The scheduler NEVER auto-approves ideas. Newly generated ideas
 *     land as `status='generated'` and wait for human review. v1
 *     autopilot's role is to keep the well stocked + auto-convert
 *     anything the user has already blessed.
 *   * The scheduler NEVER auto-publishes articles. Drafts land as
 *     `ready_for_review` regardless of `requireReview` (publishing
 *     ships in a later PR — see Auto-publishing tab in
 *     `BlogSettingsTabs`, currently gated as "Coming soon").
 *   * The scheduler is OBSERVABLE: every per-blog tick writes a row
 *     into `blog_autopilot_runs` with counters, output payload, and
 *     the resulting article job ids. The future ops drawer reads
 *     those rows.
 *
 * Composition: this module composes existing helpers. It does NOT
 * duplicate orchestration. The actual idea-generation and article-
 * generation pipelines live in `article-generation-service.ts` and
 * are the same code paths the manual flow runs through. Autopilot
 * just decides WHEN to call them.
 */

type Client = SupabaseClient<Database>;

/**
 * Per-run hard cap on article workflow starts. Even if the blog's
 * configured limits + token balance allow more, a single scheduler
 * tick won't spawn more than this many parallel workflows for one
 * blog. Keeps the global tray + Vercel Workflows queue manageable
 * during the first few autopilot runs after a fresh idea backlog.
 */
export const PER_RUN_ARTICLE_CAP = 5;

/**
 * Per-run hard cap on `generate_ideas` batch size. Even if the
 * blog's configured `backlogThreshold` is huge and `usableBacklog`
 * is 0, a single scheduler tick won't ask the AI for more than this
 * many ideas in one call. Keeps Claude responses on-topic (the
 * provider tends to repeat itself past ~15) AND prevents a fresh
 * autopilot blog from burning a large chunk of the team's token
 * balance on a single backlog top-up.
 *
 * The next cron tick can keep topping up if the deficit is still
 * non-zero, so this only spreads the work across ticks — it never
 * blocks reaching `backlogThreshold`.
 */
export const MAX_AUTOPILOT_IDEAS_PER_RUN = 10;

/**
 * Operational backpressure throttles for autopilot — NOT product /
 * subscription / pricing limits.
 *
 * What these are:
 *   * Internal MVP safety throttles that cap how many
 *     `pending` + `processing` `generate_article` jobs autopilot
 *     keeps IN FLIGHT at once.
 *   * Defenses against cron stampedes, runaway duplicate jobs,
 *     and provider rate-limit bursts (Anthropic, Pexels, the
 *     Vercel Workflows queue).
 *   * Skipped runs caused by these throttles are recorded as
 *     `skipped`, not `failed` — autopilot resumes naturally on
 *     the next cron tick once the in-flight jobs finish.
 *
 * What these are NOT:
 *   * NOT a daily generation cap. Daily output is controlled by
 *     `settings.automation.maxPostsPerDay` /
 *     `settings.automation.generatePerWeek` and gated by the
 *     team's Synth-token balance + per-blog `dailyTokenBudget`.
 *     A 10 posts/day blog can absolutely reach 10 posts/day —
 *     these throttles only spread the work across multiple
 *     15-minute cron ticks.
 *   * NOT tied to the customer's subscription tier or Stripe
 *     plan. There is no plan-based concurrency in MVP. Tying
 *     concurrency to pricing is something we may revisit
 *     post-launch; for now the constants are deliberately
 *     non-customer-facing.
 *   * NOT exposed in any settings UI. Adjust them in code if
 *     operations needs more headroom.
 *
 * Defaults:
 *   * 3 per blog — large enough to hide normal latency (one
 *     workflow finishes while the cron starts the next) but
 *     small enough that an outage doesn't accumulate dozens of
 *     concurrent jobs.
 *   * 20 per team — protects a multi-blog project from runaway
 *     concurrency: 20 blogs × 3 jobs/blog would otherwise be 60
 *     concurrent workflows. The cap is enforced per blog tick;
 *     other teams' blogs in the same scheduler invocation are
 *     unaffected.
 */
export const AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_BLOG = 3;

/**
 * See {@link AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_BLOG}. Same
 * "operational backpressure, not a product limit" posture, scoped
 * across every blog in a team.
 */
export const AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_TEAM = 20;

/**
 * Auto-pause policy defaults.
 *
 * "If N runs failed in the last M minutes, pause autopilot."
 *
 * The numbers are tuned conservatively for v1:
 *   * 30-minute window matches 2x the cron cadence (15 min) — long
 *     enough to catch real trouble but short enough that yesterday's
 *     incident doesn't keep autopilot disabled today.
 *   * 3 failures lets a single network blip slide; only the third
 *     failure triggers the pause. Same blast radius as the
 *     generate-article retry policy.
 *
 * Both are overridable per-call via {@link shouldPauseAutopilotForFailures}
 * so a future "Run Autopilot Now" UI option ("ignore recent failures")
 * or a power-user setting can tune them without touching this module.
 */
export const AUTOPAUSE_FAILURE_WINDOW_MINUTES = 30;
export const AUTOPAUSE_FAILURE_THRESHOLD = 3;

/**
 * Reason code stamped on `settings.automation.pausedReason` when the
 * scheduler auto-pauses a blog. Currently the only value; a future
 * "budget exhausted" or "plan downgrade" pause would add new codes.
 */
export const PAUSED_REASON_FAILURE_RATE = "failure_rate";

export interface AutoApproveIdeasInput {
  blogId: string;
  /**
   * Ideas the current autopilot run just inserted via
   * `generateArticleIdeas`. We only update rows whose id is in this
   * set so previously-generated (manual or older-run) ideas are
   * never touched, regardless of `requireReview`.
   */
  ideaIds: string[];
  client?: Client;
}

export interface AutoApproveIdeasResult {
  /**
   * Number of rows actually flipped from `generated → approved`.
   * Lower than `ideaIds.length` is normal — anything that drifted
   * out of `generated` between insert and approve (e.g. a manual
   * Approve / Reject from a fast-clicking user) is silently skipped.
   */
  approvedCount: number;
}

/**
 * Auto-approval policy:
 *
 *   * Gated by `settings.automation.requireReview === false` —
 *     the caller (runAutopilotForBlog) checks the gate; this helper
 *     just does the write.
 *   * Defense in depth: scopes the update to `blog_id = blogId` AND
 *     `id IN (ideaIds)` AND `status = 'generated'`. Even if a stale
 *     id from another blog leaked into `ideaIds`, RLS + this filter
 *     prevent cross-blog drift.
 *   * Idempotent: re-running the helper for the same `ideaIds` is
 *     a no-op once they're already approved.
 */
export async function autoApproveIdeasForAutopilotRun(
  input: AutoApproveIdeasInput,
): Promise<AutoApproveIdeasResult> {
  if (input.ideaIds.length === 0) return { approvedCount: 0 };
  const supabase = input.client ?? createAdminClient();
  const { data, error } = await supabase
    .from("article_ideas")
    .update({ status: "approved" satisfies ArticleIdeaStatus })
    .eq("blog_id", input.blogId)
    .eq("status", "generated" satisfies ArticleIdeaStatus)
    .in("id", input.ideaIds)
    .select("id");
  if (error) throw error;
  /* v8 ignore next 1 -- defensive: PostgREST returns array on success */
  return { approvedCount: data?.length ?? 0 };
}

/**
 * User-facing copy that lands in `settings.automation.pausedMessage`
 * when this module pauses a blog. The settings panel renders it
 * verbatim so changing the wording here changes what every paused
 * user sees.
 */
export const PAUSED_MESSAGE_FAILURE_RATE =
  "Autopilot was paused because multiple recent runs failed. Review recent runs, then re-enable autopilot when you're ready.";

export interface ShouldPauseAutopilotInput {
  blogId: string;
  /** Defaults to {@link AUTOPAUSE_FAILURE_WINDOW_MINUTES}. */
  failureWindowMinutes?: number;
  /** Defaults to {@link AUTOPAUSE_FAILURE_THRESHOLD}. */
  failureThreshold?: number;
  /** Override `Date.now()`; tests use this for deterministic windows. */
  now?: Date;
  client?: Client;
}

/**
 * Pure-ish policy: counts `failed` runs for the blog in the rolling
 * window and returns `true` when the count is at or above the
 * threshold. Skipped / cancelled runs are NOT counted — they're
 * healthy outcomes (no work needed, daily cap hit, etc.).
 *
 * Both manual and cron failures count toward the same threshold so
 * a user clicking "Run Now" repeatedly in the middle of an outage
 * gets the same protection as a quietly running cron loop.
 */
export async function shouldPauseAutopilotForFailures(
  input: ShouldPauseAutopilotInput,
): Promise<{
  shouldPause: boolean;
  failureCount: number;
  windowMinutes: number;
  threshold: number;
}> {
  const supabase = input.client ?? createAdminClient();
  const windowMinutes =
    input.failureWindowMinutes ?? AUTOPAUSE_FAILURE_WINDOW_MINUTES;
  const threshold = input.failureThreshold ?? AUTOPAUSE_FAILURE_THRESHOLD;
  const now = input.now ?? new Date();
  const cutoffIso = new Date(
    now.getTime() - windowMinutes * 60_000,
  ).toISOString();

  const { count, error } = await supabase
    .from("blog_autopilot_runs")
    .select("id", { count: "exact", head: true })
    .eq("blog_id", input.blogId)
    .eq("status", "failed")
    .gte("created_at", cutoffIso);
  if (error) throw error;
  const failureCount = count ?? 0;
  return {
    shouldPause: failureCount >= threshold,
    failureCount,
    windowMinutes,
    threshold,
  };
}

/**
 * Updates `blogs.settings.automation` to flip `enabled=false` and
 * stamp the pause-metadata fields the UI reads. Mode is preserved
 * (the user's autopilot config is intact, just disarmed).
 *
 * Read-then-write merge — we can't use jsonb_set per-field because
 * we need to set four nested keys in one go and the client SDK
 * doesn't expose a multi-jsonb_set call. The window for a stomp is
 * tiny (the user would have to be saving settings the same
 * millisecond the scheduler is pausing), and the worst case is the
 * user's save wins and the auto-pause is dropped — which the next
 * cron tick would re-detect within 30 minutes.
 */
export async function pauseAutopilotForBlog(
  client: Client,
  blogId: string,
  reason: string,
  message: string,
  now: Date = new Date(),
): Promise<void> {
  const { data, error: readErr } = await client
    .from("blogs")
    .select("settings")
    .eq("id", blogId)
    .maybeSingle();
  if (readErr) throw readErr;
  /* v8 ignore next 1 -- defensive: caller already verified the blog exists */
  if (!data) return;

  const currentSettings =
    data.settings &&
    typeof data.settings === "object" &&
    !Array.isArray(data.settings)
      ? (data.settings as Record<string, unknown>)
      : {};
  const currentAutomation =
    currentSettings.automation &&
    typeof currentSettings.automation === "object" &&
    !Array.isArray(currentSettings.automation)
      ? (currentSettings.automation as Record<string, unknown>)
      : {};

  const nextSettings = {
    ...currentSettings,
    automation: {
      ...currentAutomation,
      enabled: false,
      pausedReason: reason,
      pausedAt: now.toISOString(),
      pausedMessage: message,
    },
  } as Json;

  const { error: updateErr } = await client
    .from("blogs")
    .update({ settings: nextSettings })
    .eq("id", blogId);
  /* v8 ignore next 1 -- defensive throw; caller's catch swallows or surfaces */
  if (updateErr) throw updateErr;
}

/**
 * Merges a partial patch into an existing `blog_autopilot_runs.output`
 * jsonb. Used to stamp `autopilotPaused: true` onto the just-failed
 * run after the auto-pause check fires.
 */
async function mergeAutopilotRunOutput(
  client: Client,
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data, error: readErr } = await client
    .from("blog_autopilot_runs")
    .select("output")
    .eq("id", runId)
    .maybeSingle();
  if (readErr) throw readErr;
  /* v8 ignore next 1 -- defensive: caller just wrote this row */
  if (!data) return;

  const currentOutput =
    data.output &&
    typeof data.output === "object" &&
    !Array.isArray(data.output)
      ? (data.output as Record<string, unknown>)
      : {};

  const { error: updateErr } = await client
    .from("blog_autopilot_runs")
    .update({ output: { ...currentOutput, ...patch } as Json })
    .eq("id", runId);
  /* v8 ignore next 1 -- defensive throw */
  if (updateErr) throw updateErr;
}

/**
 * Run after every `failBlogAutopilotRun` call. Counts recent
 * failures, and if the threshold is met:
 *   * flips `blogs.settings.automation.enabled = false` + stamps
 *     pause metadata,
 *   * stamps `autopilotPaused: true, pauseReason: "failure_rate"`
 *     on the just-failed run's output so the recent-runs panel
 *     shows the pause reason inline.
 *
 * Best-effort: the pause check + the metadata writes are wrapped in
 * a try/catch so a transient supabase blip on the policy query
 * doesn't mask the original failure. Operators can investigate via
 * the next cron tick or the recent-runs panel.
 */
async function maybePauseAutopilotAfterFailure(
  client: Client,
  blogId: string,
  runId: string,
  now: Date,
): Promise<{ paused: boolean; failureCount: number }> {
  try {
    const policy = await shouldPauseAutopilotForFailures({
      blogId,
      now,
      client,
    });
    if (!policy.shouldPause) {
      return { paused: false, failureCount: policy.failureCount };
    }

    await pauseAutopilotForBlog(
      client,
      blogId,
      PAUSED_REASON_FAILURE_RATE,
      PAUSED_MESSAGE_FAILURE_RATE,
      now,
    );
    try {
      await mergeAutopilotRunOutput(client, runId, {
        autopilotPaused: true,
        pauseReason: PAUSED_REASON_FAILURE_RATE,
      });
      /* v8 ignore start -- defensive: secondary failure during stamp */
    } catch {
      // Pause itself succeeded; the panel will still show the
      // paused settings even if the per-run output stamp didn't land.
    }
    /* v8 ignore stop */
    return { paused: true, failureCount: policy.failureCount };
    /* v8 ignore start -- defensive: pause-check is best effort */
  } catch {
    return { paused: false, failureCount: 0 };
  }
  /* v8 ignore stop */
}

/**
 * Eligibility filter shared by the scheduler + tests. Pure so test
 * fixtures can call it directly to assert which blogs would tick.
 */
export interface EligibleBlogRow {
  id: string;
  project_id: string;
  team_id: string;
  settings: Json;
}

interface ScheduledBlog {
  blogId: string;
  projectId: string;
  teamId: string;
}

export interface RunAutopilotForBlogInput {
  teamId: string;
  projectId: string;
  blogId: string;
  /**
   * The user who manually kicked the run (only meaningful when
   * `triggerSource === "manual"`). `null` for cron / system runs.
   */
  triggeredByUserId?: string | null;
  triggerSource?: BlogAutopilotRunTriggerSource;
  /**
   * When `true`, the run row is still created (for audit) but no
   * workflows are started, no tokens are consumed, and no ideas are
   * generated. The output payload describes what WOULD have happened.
   */
  dryRun?: boolean;
  client?: Client;
  /** Override `Date.now()` — tests use this to make windows deterministic. */
  now?: Date;
}

export interface RunAutopilotForBlogResult {
  runId: string;
  status: "completed" | "skipped" | "failed";
  /** Reason field surfaced into the run's `output.reason`. */
  reason: string | null;
  ideasGenerated: number;
  articleJobsStarted: number;
  /** Article job ids that were queued + had a workflow started. */
  articleJobIds: string[];
  /**
   * Whatever else the scheduler decided to stamp onto the run's
   * output payload (token-spend snapshot, daily caps, etc.). Useful
   * for tests; the dashboard reads the run row directly.
   */
  output: Record<string, unknown>;
}

export interface RunBlogAutopilotSchedulerInput {
  /** Cap on blogs scanned per cron tick. Defaults to 50. */
  limit?: number;
  triggerSource?: BlogAutopilotRunTriggerSource;
  dryRun?: boolean;
  now?: Date;
  client?: Client;
}

export interface RunBlogAutopilotSchedulerResult {
  blogsChecked: number;
  /**
   * `blogsSkippedDueToLimit > 0` means there were more eligible
   * blogs than the cron tick's `limit` allowed. The next tick
   * (15 minutes later, by default) will pick up the rest.
   *
   * Why this exists: a project with hundreds of armed blogs would
   * otherwise silently process the first N every tick without any
   * signal that it's NOT processing them all — operators wouldn't
   * know whether autopilot is keeping up or falling behind.
   *
   * Computed by counting eligible blogs at scan time
   * (`{ count: 'exact' }`) and subtracting the number we processed.
   */
  blogsSkippedDueToLimit: number;
  /**
   * Total number of eligible blogs the scan saw, regardless of
   * `limit`. Always `>= blogsChecked + blogsSkippedDueToLimit`.
   * Surfaced so dashboards can chart "fleet size" over time.
   */
  blogsEligibleTotal: number;
  runsCreated: number;
  runsSkipped: number;
  runsFailed: number;
  ideasGenerated: number;
  articleJobsStarted: number;
  errors: string[];
  /** Per-blog summary so the cron route can return it for inspection. */
  perBlog: Array<{
    blogId: string;
    runId: string | null;
    status: "completed" | "skipped" | "failed" | "error";
    reason?: string | null;
    articleJobsStarted?: number;
    ideasGenerated?: number;
    error?: string;
  }>;
}

const SCHEDULER_DEFAULT_LIMIT = 50;

// ----------------------------------------------------------------------------
// runBlogAutopilotScheduler — the cron entry point
// ----------------------------------------------------------------------------

/**
 * Top-level entry point. Loads up to `limit` blogs whose
 * `settings.automation` is armed (`mode='autopilot' AND enabled=true`)
 * and ticks each one through {@link runAutopilotForBlog}. Errors on
 * a single blog don't stop the rest.
 */
export async function runBlogAutopilotScheduler(
  input: RunBlogAutopilotSchedulerInput = {},
): Promise<RunBlogAutopilotSchedulerResult> {
  const supabase = input.client ?? createAdminClient();
  const limit = input.limit ?? SCHEDULER_DEFAULT_LIMIT;

  const result: RunBlogAutopilotSchedulerResult = {
    blogsChecked: 0,
    blogsSkippedDueToLimit: 0,
    blogsEligibleTotal: 0,
    runsCreated: 0,
    runsSkipped: 0,
    runsFailed: 0,
    ideasGenerated: 0,
    articleJobsStarted: 0,
    errors: [],
    perBlog: [],
  };

  let blogs: ScheduledBlog[];
  let totalEligible: number;
  try {
    const loaded = await loadEligibleBlogs(supabase, limit);
    blogs = loaded.blogs;
    totalEligible = loaded.totalEligible;
  } catch (err) {
    result.errors.push(`load_blogs: ${describeErr(err)}`);
    return result;
  }
  result.blogsEligibleTotal = totalEligible;
  result.blogsSkippedDueToLimit = Math.max(0, totalEligible - blogs.length);

  for (const blog of blogs) {
    result.blogsChecked += 1;
    try {
      const blogResult = await runAutopilotForBlog({
        teamId: blog.teamId,
        projectId: blog.projectId,
        blogId: blog.blogId,
        triggerSource: input.triggerSource ?? "cron",
        dryRun: input.dryRun,
        now: input.now,
        client: supabase,
      });
      if (blogResult.status === "completed") result.runsCreated += 1;
      if (blogResult.status === "skipped") result.runsSkipped += 1;
      /* v8 ignore next 1 -- defensive: failed runs surface via `errors` */
      if (blogResult.status === "failed") result.runsFailed += 1;
      result.ideasGenerated += blogResult.ideasGenerated;
      result.articleJobsStarted += blogResult.articleJobsStarted;
      result.perBlog.push({
        blogId: blog.blogId,
        runId: blogResult.runId,
        status: blogResult.status,
        reason: blogResult.reason,
        articleJobsStarted: blogResult.articleJobsStarted,
        ideasGenerated: blogResult.ideasGenerated,
      });
    } catch (err) {
      // runAutopilotForBlog catches its own errors and marks the run
      // failed, so reaching this branch means an exception escaped
      // (e.g. createBlogAutopilotRun itself failed). Record it but
      // keep iterating — a misconfigured blog shouldn't take the
      // whole tick down.
      const message = describeErr(err);
      result.errors.push(`blog_${blog.blogId}: ${message}`);
      result.perBlog.push({
        blogId: blog.blogId,
        runId: null,
        status: "error",
        error: message,
      });
    }
  }

  return result;
}

// ----------------------------------------------------------------------------
// runAutopilotForBlog — the per-blog tick
// ----------------------------------------------------------------------------

export async function runAutopilotForBlog(
  input: RunAutopilotForBlogInput,
): Promise<RunAutopilotForBlogResult> {
  const supabase = input.client ?? createAdminClient();
  const triggerSource = input.triggerSource ?? "cron";
  const now = input.now ?? new Date();

  // 1. Create the run row up front so even an early failure leaves a
  // breadcrumb. Stays in `processing` until we explicitly complete
  // / skip / fail it.
  const run = await createBlogAutopilotRun({
    teamId: input.teamId,
    projectId: input.projectId,
    blogId: input.blogId,
    triggerSource,
    triggeredByUserId: input.triggeredByUserId ?? null,
    status: "processing",
    currentStep: "loading_settings",
    input: {
      triggerSource,
      dryRun: Boolean(input.dryRun),
      cutoffNow: now.toISOString(),
    },
    client: supabase,
  });

  try {
    // 2. Load settings + budget snapshot.
    const ctx = await loadBlogContext(supabase, input.blogId);
    if (!ctx) {
      await skip(supabase, run.id, AUTOPILOT_SKIP_REASONS.BLOG_NOT_FOUND);
      return makeResult(
        run.id,
        "skipped",
        AUTOPILOT_SKIP_REASONS.BLOG_NOT_FOUND,
      );
    }

    const { settings, blog: blogRow } = ctx;

    // Defensive: re-check eligibility. The cron loader already
    // filtered, but a manual "Run now" call could target any blog
    // and we don't want to silently spawn workflows for one whose
    // owner just disarmed autopilot.
    if (
      settings.automation.mode !== "autopilot" ||
      !settings.automation.enabled
    ) {
      await skip(supabase, run.id, AUTOPILOT_SKIP_REASONS.AUTOPILOT_DISABLED);
      return makeResult(
        run.id,
        "skipped",
        AUTOPILOT_SKIP_REASONS.AUTOPILOT_DISABLED,
      );
    }

    // 3. Token + daily-spend budget check.
    await updateBlogAutopilotRunStatus({
      runId: run.id,
      currentStep: "checking_budget",
      client: supabase,
    });

    const articleCost = getCreditCost("generateArticle");
    const ideaCost = getCreditCost("generateIdeas");

    const teamPlan = await getTeamPlan(input.teamId, supabase);
    if (!teamPlan) {
      await skip(
        supabase,
        run.id,
        AUTOPILOT_SKIP_REASONS.TEAM_BILLING_UNAVAILABLE,
      );
      return makeResult(
        run.id,
        "skipped",
        AUTOPILOT_SKIP_REASONS.TEAM_BILLING_UNAVAILABLE,
      );
    }

    const tokenBalance = teamPlan.balance;
    const tokensSpentToday = await sumTokensSpentForBlogToday(
      supabase,
      input.blogId,
      now,
    );

    // The articles-allowed-by-daily-budget calculation is conservative
    // — we don't dip below 0 if the user has already overspent today
    // somehow.
    const dailyTokenBudget = settings.automation.dailyTokenBudget;
    const tokensRemainingFromBudget =
      dailyTokenBudget !== null
        ? Math.max(0, dailyTokenBudget - tokensSpentToday)
        : null;

    // 4. Article-count budget check. "How many articles am I allowed
    // to start in this tick?" — driven by maxPostsPerDay, the
    // weekly-divided-by-7 daily allowance, and what's already been
    // started today (any status, calendar-day local to the blog's
    // configured timezone or UTC).
    const dailyUsage = await getBlogDailyArticleGenerationUsage({
      blogId: input.blogId,
      timezone: settings.automation.timezone,
      now,
      maxPostsPerDay: settings.automation.maxPostsPerDay,
      generatePerWeek: settings.automation.generatePerWeek,
      client: supabase,
    });
    const articlesStartedToday = dailyUsage.jobsStartedToday;
    const dailyMaxFromConfig = dailyUsage.dailyLimit;
    const articleSlotsRemainingToday = dailyUsage.remainingToday;

    // 5. Backlog check + idea top-up.
    await updateBlogAutopilotRunStatus({
      runId: run.id,
      currentStep: "checking_backlog",
      client: supabase,
    });

    const backlogThreshold = settings.automation.backlogThreshold;
    const initialApprovedIdeas = await listApprovedIdeasForBlog(
      supabase,
      input.blogId,
    );
    let approvedIdeas = initialApprovedIdeas;

    // Backlog metric for top-up math is the count of USABLE ideas
    // (`generated` + `approved`, all non-archived). Counting
    // generated-but-not-yet-reviewed prevents a `requireReview=true`
    // blog from re-topping-up to 10 generated ideas on every single
    // cron tick — those ideas will become approved when a human
    // reviews them, so they DO count toward the configured backlog.
    // `rejected` and `converted_to_article` never count.
    const usableBacklog = await countUsableIdeasForBacklog(
      input.blogId,
      supabase,
    );

    let ideasGenerated = 0;
    // Tracked separately from `ideasGenerated` so the run output
    // can answer the question "did autopilot move ideas straight
    // into the article queue, or did they stop at 'generated'?"
    let ideasAutoApproved = 0;
    // Deficit-based top-up: only generate enough to refill the gap
    // (clamped to a per-run safety cap). With backlogThreshold=10 and
    // usableBacklog=7, this generates 3 — not always 10. A fresh
    // blog (usableBacklog=0) still gets a full MAX_AUTOPILOT_IDEAS_PER_RUN
    // burst, and the next cron tick keeps topping up until the
    // threshold is reached.
    const deficit = Math.max(0, backlogThreshold - usableBacklog);
    const ideasToGenerate = Math.min(deficit, MAX_AUTOPILOT_IDEAS_PER_RUN);
    if (
      ideasToGenerate > 0 &&
      tokenBalance >= ideaCost &&
      (tokensRemainingFromBudget === null ||
        tokensRemainingFromBudget >= ideaCost) &&
      !input.dryRun
    ) {
      await updateBlogAutopilotRunStatus({
        runId: run.id,
        currentStep: "generating_ideas",
        client: supabase,
      });

      try {
        const batch = await generateArticleIdeas({
          blogId: input.blogId,
          teamId: input.teamId,
          userId: teamPlan.ownerId,
          triggerSource: "autopilot",
          // Pass the exact deficit-clamped count instead of letting
          // `generateArticleIdeas` default to IDEA_DEFAULT_COUNT.
          // This is the line that makes "top up to threshold" actually
          // mean "only request the missing amount".
          count: ideasToGenerate,
          jobMetadata: {
            autopilotRunId: run.id,
            backlogThreshold,
            usableBacklog,
          },
          client: supabase,
        });
        ideasGenerated = batch.ideas.length;

        // Auto-approve gate. Strictly scoped to ids the *current run*
        // just inserted — older `generated` ideas (manual or from a
        // previous autopilot run when requireReview was true) are
        // never touched. The auto-approve helper double-filters on
        // `status = 'generated'` so any race-approved rows are
        // skipped silently.
        if (
          settings.automation.requireReview === false &&
          batch.ideas.length > 0 &&
          !input.dryRun
        ) {
          const result = await autoApproveIdeasForAutopilotRun({
            blogId: input.blogId,
            ideaIds: batch.ideas.map((idea) => idea.id),
            client: supabase,
          });
          ideasAutoApproved = result.approvedCount;
        }
      } catch (err) {
        // Idea generation failed (likely Claude / network). Mark the
        // run failed and bail — no point trying to spawn article
        // workflows from a stale backlog when the budget context
        // could be wrong.
        const message = describeErr(err);
        await failBlogAutopilotRun({
          runId: run.id,
          errorMessage: `Idea generation failed: ${message}`,
          output: { stage: "generating_ideas" },
          client: supabase,
        });
        const pauseInfo = await maybePauseAutopilotAfterFailure(
          supabase,
          input.blogId,
          run.id,
          now,
        );
        return makeResult(run.id, "failed", "idea_generation_failed", {
          ideasGenerated: 0,
          articleJobsStarted: 0,
          articleJobIds: [],
          extra: {
            error: message,
            ...(pauseInfo.paused
              ? {
                  autopilotPaused: true,
                  pauseReason: PAUSED_REASON_FAILURE_RATE,
                  failureCount: pauseInfo.failureCount,
                }
              : {}),
          },
        });
      }

      // Refresh the approved-ideas list in case any of the new ideas
      // somehow landed as approved (they shouldn't — `generateArticleIdeas`
      // marks them `generated`. But this keeps the count honest if
      // the orchestration's behavior changes.)
      approvedIdeas = await listApprovedIdeasForBlog(supabase, input.blogId);
    }

    // 6. Spawn article workflows for approved ideas, capped.
    await updateBlogAutopilotRunStatus({
      runId: run.id,
      currentStep: "generating_articles",
      client: supabase,
    });

    const tokensFromBalance = Math.floor(tokenBalance / articleCost);
    const tokensFromBudget =
      tokensRemainingFromBudget !== null
        ? Math.floor(tokensRemainingFromBudget / articleCost)
        : Number.POSITIVE_INFINITY;
    const articlesAllowedByTokens = Math.max(
      0,
      Math.min(tokensFromBalance, tokensFromBudget),
    );

    // 6a. Operational backpressure throttles. NOT product caps —
    // a 10 posts/day blog can still hit 10 posts/day across cron
    // ticks; these throttles only spread the work so a single
    // tick doesn't fan out a queue storm. Two caps share a single
    // early-exit path:
    //
    //   * per-blog — stops a tick from stacking jobs on top of a
    //     prior tick's still-processing workflows.
    //   * per-team — protects a multi-blog project (think 20
    //     blogs × 3 jobs each = 60 concurrent workflows) from
    //     saturating Anthropic / Pexels / Vercel Workflows queue.
    //
    // When a throttle binds, the run records `skipped` with a
    // `*_limit_reached` reason and the next cron tick continues
    // naturally once jobs drain. Token balance + daily article
    // cap remain the customer-facing controls.
    //
    // We compute the remaining-slots numbers BEFORE
    // `articlesToStart` so the spawn loop is bounded by the
    // tightest of {daily cap, token budget, per-run cap,
    // operational throttle}. Querying the counts lazily here
    // (not earlier) keeps the early skip paths fast for blogs
    // that have nothing to do.
    const activeJobsForBlog = await countActiveArticleJobsForBlog({
      blogId: input.blogId,
      client: supabase,
    });
    const activeBlogSlotsRemaining = Math.max(
      0,
      AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_BLOG - activeJobsForBlog,
    );

    const activeJobsForTeam = await countActiveArticleJobsForTeam({
      teamId: input.teamId,
      client: supabase,
    });
    const activeTeamSlotsRemaining = Math.max(
      0,
      AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_TEAM - activeJobsForTeam,
    );

    const articlesToStart = Math.min(
      approvedIdeas.length,
      articleSlotsRemainingToday,
      articlesAllowedByTokens,
      PER_RUN_ARTICLE_CAP,
      activeBlogSlotsRemaining,
      activeTeamSlotsRemaining,
    );

    const articleJobIds: string[] = [];
    let articleJobsStarted = 0;
    let lastSpawnError: string | null = null;

    if (articlesToStart > 0 && !input.dryRun) {
      // Loop is bounded by the slot count AND the available
      // ideas. Dedupe-skipped ideas DON'T consume a slot — we
      // keep walking the approved-ideas list until we've either
      // filled all `articlesToStart` slots with fresh spawns OR
      // run out of ideas to try. Without this, an idea whose
      // article was already generated would silently waste a
      // daily-cap slot and a 10-posts/day blog could end up
      // starting only 5 jobs because half its backlog had stale
      // completed jobs.
      let ideaCursor = 0;
      while (
        articleJobsStarted < articlesToStart &&
        ideaCursor < approvedIdeas.length
      ) {
        const idea = approvedIdeas[ideaCursor];
        ideaCursor += 1;
        try {
          // Pre-flight dedupe: skip ideas that already have an
          // active OR completed `generate_article` job. Saves a
          // round-trip to `queueGenerateArticleFromIdea` (which
          // would also short-circuit on `pending`/`processing`,
          // but we want the loop to advance to a fresh idea
          // immediately rather than spending the slot on a
          // duplicate-detection pass). Failed jobs are NOT
          // short-circuited — those should retry on the next tick.
          const alreadyExists = await hasExistingArticleGenerationForIdea({
            ideaId: idea.id,
            blogId: input.blogId,
            client: supabase,
          });
          if (alreadyExists) continue;

          const queued = await queueGenerateArticleFromIdea({
            blogId: input.blogId,
            teamId: input.teamId,
            userId: teamPlan.ownerId,
            ideaId: idea.id,
            triggerSource: "autopilot",
            jobMetadata: { autopilotRunId: run.id },
            client: supabase,
          });
          // The workflow is what actually consumes tokens + calls
          // Claude. queueGenerateArticleFromIdea is idempotent on
          // already-pending jobs for the same idea (defense in
          // depth — we already filtered above). A re-run of the
          // scheduler hour later won't double-spawn workflows.
          if (!queued.alreadyQueued) {
            await start(generateArticleWorkflow, [
              {
                jobId: queued.jobId,
                articleId: queued.articleId,
                blogId: input.blogId,
                teamId: input.teamId,
                userId: teamPlan.ownerId,
                ideaId: idea.id,
                triggerSource: "autopilot",
                autopilotRunId: run.id,
              },
            ]);
            articleJobsStarted += 1;
            articleJobIds.push(queued.jobId);
          }
        } catch (err) {
          lastSpawnError = describeErr(err);
          // Don't stop the loop on a single per-idea failure — the
          // others might still queue cleanly. The run row records
          // the error in its output.
        }
      }
    }

    // 7. Decide on the final status.
    const noWorkDone =
      ideasGenerated === 0 &&
      articleJobsStarted === 0 &&
      lastSpawnError === null;

    if (noWorkDone) {
      // Distinguish "all caps hit" from "everything's healthy, the
      // backlog's just empty" so the dashboard can hint useful
      // remediation.
      const reason = pickSkipReason({
        approvedIdeasCount: approvedIdeas.length,
        articleSlotsRemainingToday,
        articlesAllowedByTokens,
        activeBlogSlotsRemaining,
        activeTeamSlotsRemaining,
        backlogThreshold,
        belowBacklog: initialApprovedIdeas.length < backlogThreshold,
        tokenBalance,
        ideaCost,
        dryRun: Boolean(input.dryRun),
      });
      await completeBlogAutopilotRun({
        runId: run.id,
        status: "skipped",
        output: buildOutput({
          reason,
          tokenBalance,
          tokensSpentToday,
          tokensRemainingFromBudget,
          dailyMaxFromConfig,
          articlesStartedToday,
          approvedIdeasCount: approvedIdeas.length,
          articleJobIds,
          dryRun: Boolean(input.dryRun),
          ideasAutoApproved,
          requireReview: settings.automation.requireReview,
          activeJobsForBlog,
          activeJobsForTeam,
        }),
        client: supabase,
      });
      return makeResult(run.id, "skipped", reason, {
        ideasGenerated,
        articleJobsStarted,
        articleJobIds,
      });
    }

    await completeBlogAutopilotRun({
      runId: run.id,
      status: "completed",
      countersDelta: { ideasGenerated, articlesStarted: articleJobsStarted },
      output: buildOutput({
        reason: lastSpawnError
          ? AUTOPILOT_SKIP_REASONS.PARTIAL_FAILURE
          : AUTOPILOT_SKIP_REASONS.OK,
        tokenBalance,
        tokensSpentToday,
        tokensRemainingFromBudget,
        dailyMaxFromConfig,
        articlesStartedToday,
        approvedIdeasCount: approvedIdeas.length,
        articleJobIds,
        dryRun: Boolean(input.dryRun),
        lastSpawnError,
        blogName: blogRow.name,
        ideasAutoApproved,
        requireReview: settings.automation.requireReview,
        activeJobsForBlog,
        activeJobsForTeam,
      }),
      client: supabase,
    });

    return makeResult(
      run.id,
      "completed",
      lastSpawnError ? AUTOPILOT_SKIP_REASONS.PARTIAL_FAILURE : null,
      {
        ideasGenerated,
        articleJobsStarted,
        articleJobIds,
      },
    );
  } catch (err) {
    const message = describeErr(err);
    await failBlogAutopilotRun({
      runId: run.id,
      errorMessage: message,
      client: supabase,
    });
    const pauseInfo = await maybePauseAutopilotAfterFailure(
      supabase,
      input.blogId,
      run.id,
      now,
    );
    return makeResult(run.id, "failed", message, {
      ideasGenerated: 0,
      articleJobsStarted: 0,
      articleJobIds: [],
      extra: {
        error: message,
        ...(pauseInfo.paused
          ? {
              autopilotPaused: true,
              pauseReason: PAUSED_REASON_FAILURE_RATE,
              failureCount: pauseInfo.failureCount,
            }
          : {}),
      },
    });
  }
}

// ============================================================================
// Helpers — exported only as needed for tests
// ============================================================================

/**
 * Loads up to `limit` blogs whose owner has explicitly armed
 * autopilot AND a count of how many are eligible IN TOTAL (so the
 * scheduler can report `blogsSkippedDueToLimit` when more blogs
 * exist than this tick can process).
 *
 * Uses the jsonb `->>` operator — no separate column for `mode` /
 * `enabled`, everything lives in `blogs.settings.automation` per
 * the cleanup PR. The `count: 'exact'` modifier asks PostgREST
 * for the unfiltered total alongside the limited rows in a single
 * query.
 */
async function loadEligibleBlogs(
  client: Client,
  limit: number,
): Promise<{ blogs: ScheduledBlog[]; totalEligible: number }> {
  // Project membership is intentionally NOT joined — the run row
  // captures team_id directly from the project, and a deleted
  // project would cascade-delete the blog (FK on `blogs.project_id`).
  const { data, error, count } = await client
    .from("blogs")
    .select("id, project_id, settings, project:projects!project_id(team_id)", {
      count: "exact",
    })
    .filter("settings->automation->>mode", "eq", "autopilot")
    .filter("settings->automation->>enabled", "eq", "true")
    .limit(limit);

  if (error) throw error;
  /* v8 ignore next 1 -- defensive: supabase returns data when error is null */
  if (!data) return { blogs: [], totalEligible: count ?? 0 };

  const out: ScheduledBlog[] = [];
  for (const row of data as Array<{
    id: string;
    project_id: string;
    settings: Json;
    project: { team_id: string } | { team_id: string }[] | null;
  }>) {
    const projectRaw = Array.isArray(row.project)
      ? row.project[0]
      : row.project;
    /* v8 ignore next 1 -- defensive: blog FK guarantees the project row */
    if (!projectRaw) continue;
    out.push({
      blogId: row.id,
      projectId: row.project_id,
      teamId: projectRaw.team_id,
    });
  }
  return { blogs: out, totalEligible: count ?? out.length };
}

/**
 * Pulls the blog row + normalized settings. Returns `null` when the
 * blog's been deleted between the eligibility scan and this read
 * (rare but possible for a long-running tick).
 */
async function loadBlogContext(client: Client, blogId: string) {
  const { data, error } = await client
    .from("blogs")
    .select("id, name, settings")
    .eq("id", blogId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    blog: { id: data.id, name: data.name },
    settings: loadBlogSettings(data.settings),
  };
}

async function listApprovedIdeasForBlog(
  client: Client,
  blogId: string,
): Promise<ArticleIdeaRow[]> {
  // FIFO `approved`-and-not-archived ideas — the autopilot picks
  // the oldest first. Archived ideas never come back to the article
  // pipeline; the user explicitly hid them from the backlog.
  const { data, error } = await client
    .from("article_ideas")
    .select("*")
    .eq("blog_id", blogId)
    .eq("status", "approved" satisfies ArticleIdeaStatus)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  /* v8 ignore next 1 -- defensive: supabase returns data when error is null */
  return (data ?? []) as ArticleIdeaRow[];
}

async function sumTokensSpentForBlogToday(
  client: Client,
  blogId: string,
  now: Date,
): Promise<number> {
  // We sum `usage_events.credits_used` for THIS blog over the last
  // 24h. usage_events is the audit log written every time the
  // orchestration successfully consumed credits, so it's the right
  // source for "what has autopilot already spent for this blog
  // today".
  const cutoffIso = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const { data, error } = await client
    .from("usage_events")
    .select("credits_used")
    .eq("blog_id", blogId)
    .gte("created_at", cutoffIso);
  if (error) throw error;
  /* v8 ignore next 1 -- defensive: supabase returns data when error is null */
  if (!data) return 0;
  let sum = 0;
  for (const row of data as { credits_used: number | null }[]) {
    sum += row.credits_used ?? 0;
  }
  return sum;
}

/**
 * Translates the user-facing settings into a single "max articles
 * for today" number. Picks the more conservative of:
 *   * `maxPostsPerDay` directly
 *   * `ceil(generatePerWeek / 7)` so a "21 / week" config doesn't
 *     accidentally translate to 21-in-one-day spikes.
 */
export function computeDailyMaxArticles(
  maxPostsPerDay: number,
  generatePerWeek: number,
): number {
  const dailyFromWeekly =
    generatePerWeek > 0 ? Math.ceil(generatePerWeek / 7) : 0;
  return Math.min(Math.max(0, maxPostsPerDay), Math.max(0, dailyFromWeekly));
}

// ----------------------------------------------------------------------------
// Daily / active-job usage helpers — public so other services + tests can
// inspect quota state without re-implementing the queries.
// ----------------------------------------------------------------------------

/**
 * Returns the UTC `Date` corresponding to local midnight (00:00:00)
 * in `timezone`, where "local" means "the calendar day `now` falls
 * on inside that timezone". Defaults to a plain UTC midnight when
 * `timezone` is `"Etc/UTC"`, falsy, or unparseable.
 *
 * Why we don't lean on the `Date` constructor:
 *   `new Date(year, month, day)` builds the local time of the
 *   *server* (which on Vercel is UTC), not the blog owner's
 *   timezone. We have to round-trip through `Intl.DateTimeFormat`
 *   to learn what the blog calls "today".
 *
 * Implementation:
 *   1. Format `now` in `timezone` to extract local Y-M-D.
 *   2. Build a candidate UTC midnight at that Y-M-D.
 *   3. Compute the timezone's offset relative to UTC at that
 *      candidate moment.
 *   4. Subtract the offset to land on the actual UTC instant of
 *      the local midnight.
 *
 * The DST trick: step 3 uses {@link computeTimezoneOffsetMs} which
 * formats the candidate again and diffs the local representation
 * against UTC. That's accurate even across spring-forward / fall-
 * back days because the offset query targets the candidate moment
 * directly, not "today's offset".
 */
export function startOfLocalDayUtc(now: Date, timezone: string): Date {
  // Normalize: "Etc/UTC" / "UTC" / falsy / weird → plain UTC midnight.
  if (!timezone || timezone === "Etc/UTC" || timezone === "UTC") {
    const iso = now.toISOString().slice(0, 10);
    return new Date(`${iso}T00:00:00.000Z`);
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    parts = dtf.formatToParts(now);
    /* v8 ignore start -- defensive: Intl.DateTimeFormat throws on garbage zones (e.g. "Mars/Olympus"); fall through to plain UTC midnight */
  } catch {
    const iso = now.toISOString().slice(0, 10);
    return new Date(`${iso}T00:00:00.000Z`);
  }
  /* v8 ignore stop */

  /* v8 ignore start -- defensive: with `year`/`month`/`day` requested in the formatter options, the corresponding parts ARE always emitted by Intl.DateTimeFormat; the `?? ""` fallback is an unreachable null guard */
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  /* v8 ignore stop */
  const year = parseInt(get("year"), 10);
  const month = parseInt(get("month"), 10);
  const day = parseInt(get("day"), 10);

  // Step 2: candidate UTC midnight of the local Y-M-D.
  const candidateUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const candidate = new Date(candidateUtcMs);

  // Step 3+4: the candidate, viewed through `timezone`, will read
  // some local time; the offset between that local time and UTC
  // at this exact moment tells us how to shift back.
  const offsetMs = computeTimezoneOffsetMs(candidate, timezone);
  return new Date(candidateUtcMs - offsetMs);
}

/**
 * Returns the offset (UTC → `timezone`) at `date`, in milliseconds.
 * Positive = `timezone` is ahead of UTC (e.g. Europe/London in
 * summer = +3600000). Negative = behind UTC (e.g. America/New_York
 * = -18000000 in winter).
 *
 * Used by {@link startOfLocalDayUtc} to convert a "candidate UTC
 * midnight" to the actual UTC instant when the blog's timezone
 * crosses to the next calendar day.
 */
function computeTimezoneOffsetMs(date: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  /* v8 ignore start -- defensive: with all six date parts requested in the formatter options, Intl.DateTimeFormat always emits them; the `?? "0"` fallback is an unreachable null guard */
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "0";
  /* v8 ignore stop */
  const localY = parseInt(get("year"), 10);
  const localMo = parseInt(get("month"), 10);
  const localD = parseInt(get("day"), 10);
  const localH = parseInt(get("hour"), 10);
  const localMi = parseInt(get("minute"), 10);
  const localS = parseInt(get("second"), 10);
  const localAsUtcMs = Date.UTC(
    localY,
    localMo - 1,
    localD,
    localH,
    localMi,
    localS,
  );
  return localAsUtcMs - date.getTime();
}

export interface BlogDailyArticleGenerationUsage {
  /** UTC instant of the blog's local-day boundary. */
  dayStart: Date;
  /** `dayStart + 24h`. Slight DST wobble is acceptable for v1 quotas. */
  dayEnd: Date;
  /**
   * Count of `article_jobs` rows where `type = 'generate_article'`
   * AND `created_at IN [dayStart, dayEnd)`. Includes pending,
   * processing, completed, AND failed/cancelled — every started
   * job counts toward the cap so a flaky generation can't be
   * retried into infinity by re-burning the user's daily quota.
   */
  jobsStartedToday: number;
  /**
   * Count of `article_jobs` rows where `type = 'generate_article'`,
   * `status = 'completed'`, AND `completed_at IN [dayStart, dayEnd)`.
   * Informational only — NOT used to gate the cap. Surfaced so
   * future dashboards can show "5 started, 3 completed".
   */
  articlesCompletedToday: number;
  /** {@link computeDailyMaxArticles} result — the binding cap. */
  dailyLimit: number;
  /** `max(0, dailyLimit - jobsStartedToday)`. */
  remainingToday: number;
}

export interface GetBlogDailyArticleGenerationUsageInput {
  blogId: string;
  /**
   * IANA zone (e.g. `"America/Los_Angeles"`). Falls back to UTC
   * when unset, `"Etc/UTC"`, `"UTC"`, or unparseable. Pull this
   * from `settings.automation.timezone`.
   */
  timezone?: string | null;
  /** Anchor moment for "today". Defaults to `new Date()`. */
  now?: Date;
  /**
   * `maxPostsPerDay` from `settings.automation`. Required so the
   * helper can compute `dailyLimit`/`remainingToday` without
   * re-loading the blog row.
   */
  maxPostsPerDay: number;
  /** `generatePerWeek` from `settings.automation`. */
  generatePerWeek: number;
  client?: Client;
}

/**
 * Centralized "how many articles is this blog allowed to start
 * today, and how many has it already started/completed?" lookup.
 *
 * Replaces the previous 24h-rolling-window helper with a calendar-
 * day window keyed off the blog's configured timezone. Two queries:
 *
 *   1. count of rows by `created_at` in [dayStart, dayEnd)
 *      → `jobsStartedToday` (all statuses).
 *   2. count of rows by `completed_at` in [dayStart, dayEnd) AND
 *      `status='completed'` → `articlesCompletedToday`.
 *
 * The two queries are kept separate (instead of one COUNT-with-
 * conditional aggregation) so each can use the existing
 * `(blog_id, created_at)` / `(blog_id, completed_at)` indexes
 * cleanly, and so a v1 caller that only needs the first count can
 * skip the second when a future caller wants to.
 *
 * Returns deterministic zeros on supabase errors only after
 * surfacing them — defensive failure here would mask a real DB
 * outage AND silently flood quotas. Callers wrap in try/catch as
 * usual.
 */
export async function getBlogDailyArticleGenerationUsage(
  input: GetBlogDailyArticleGenerationUsageInput,
): Promise<BlogDailyArticleGenerationUsage> {
  const supabase = input.client ?? createAdminClient();
  const now = input.now ?? new Date();
  const timezone = input.timezone || "Etc/UTC";

  const dayStart = startOfLocalDayUtc(now, timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

  const dailyLimit = computeDailyMaxArticles(
    input.maxPostsPerDay,
    input.generatePerWeek,
  );

  // (1) Started today — by created_at in the local day window.
  const { count: startedCount, error: startedErr } = await supabase
    .from("article_jobs")
    .select("id", { count: "exact", head: true })
    .eq("blog_id", input.blogId)
    .eq("type", "generate_article")
    .gte("created_at", dayStart.toISOString())
    .lt("created_at", dayEnd.toISOString());
  if (startedErr) throw startedErr;
  const jobsStartedToday = startedCount ?? 0;

  // (2) Completed today — by completed_at in the same window.
  const { count: completedCount, error: completedErr } = await supabase
    .from("article_jobs")
    .select("id", { count: "exact", head: true })
    .eq("blog_id", input.blogId)
    .eq("type", "generate_article")
    .eq("status", "completed")
    .gte("completed_at", dayStart.toISOString())
    .lt("completed_at", dayEnd.toISOString());
  if (completedErr) throw completedErr;
  const articlesCompletedToday = completedCount ?? 0;

  return {
    dayStart,
    dayEnd,
    jobsStartedToday,
    articlesCompletedToday,
    dailyLimit,
    remainingToday: Math.max(0, dailyLimit - jobsStartedToday),
  };
}

/**
 * Counts `pending` + `processing` `generate_article` jobs for one
 * blog. Drives the operational backpressure throttle in
 * {@link runAutopilotForBlog} (see
 * {@link AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_BLOG} for the
 * "this is NOT a product cap" framing). Pure count by status —
 * not a time window — because we care about concurrent in-flight
 * work, not how much was started today.
 */
export async function countActiveArticleJobsForBlog(input: {
  blogId: string;
  client?: Client;
}): Promise<number> {
  const supabase = input.client ?? createAdminClient();
  const { count, error } = await supabase
    .from("article_jobs")
    .select("id", { count: "exact", head: true })
    .eq("blog_id", input.blogId)
    .eq("type", "generate_article")
    .in("status", ["pending", "processing"]);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Counts `pending` + `processing` `generate_article` jobs across
 * all blogs in a team. Drives the team-wide operational
 * backpressure throttle in {@link runAutopilotForBlog} (see
 * {@link AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_TEAM} for the
 * "this is NOT a subscription / plan-tier cap" framing).
 *
 * `article_jobs` doesn't carry a denormalized `team_id` column —
 * we filter on `input->>teamId` (jsonb path) which every queue
 * caller stamps via `queueGenerateArticleFromIdea`. The string-
 * compare scan is cheap because the table is bounded by retention
 * (rows older than ~30 days are truncated by a future job) and
 * the `(team_id, status)` predicate is highly selective.
 */
export async function countActiveArticleJobsForTeam(input: {
  teamId: string;
  client?: Client;
}): Promise<number> {
  const supabase = input.client ?? createAdminClient();
  const { count, error } = await supabase
    .from("article_jobs")
    .select("id", { count: "exact", head: true })
    .eq("type", "generate_article")
    .in("status", ["pending", "processing"])
    .filter("input->>teamId", "eq", input.teamId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Returns `true` when an `active` (pending / processing) OR
 * `completed` `generate_article` job already exists for the supplied
 * idea. Used by the scheduler to skip ideas that have already been
 * (or are being) converted, even before
 * {@link queueGenerateArticleFromIdea}'s own idempotency check
 * fires — gives us an explicit `output.lastSpawnError` line per
 * skipped idea instead of a silent `alreadyQueued` bypass.
 *
 * `failed` / `cancelled` jobs do NOT count — autopilot v1 retries
 * those automatically by re-queueing on the next cron tick (the
 * idea is still `approved`, the failed job's article placeholder
 * is left as `generating`, and the new job re-uses the same idea
 * to drive a fresh attempt).
 */
export async function hasExistingArticleGenerationForIdea(input: {
  ideaId: string;
  blogId: string;
  client?: Client;
}): Promise<boolean> {
  const supabase = input.client ?? createAdminClient();
  const { count, error } = await supabase
    .from("article_jobs")
    .select("id", { count: "exact", head: true })
    .eq("article_idea_id", input.ideaId)
    .eq("blog_id", input.blogId)
    .eq("type", "generate_article")
    .in("status", ["pending", "processing", "completed"]);
  if (error) throw error;
  return (count ?? 0) > 0;
}

interface SkipReasonInput {
  approvedIdeasCount: number;
  articleSlotsRemainingToday: number;
  articlesAllowedByTokens: number;
  /**
   * Operational throttle slack: per-blog limit minus in-flight
   * jobs. NOT a product cap — see
   * {@link AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_BLOG}.
   */
  activeBlogSlotsRemaining: number;
  /**
   * Operational throttle slack: per-team limit minus in-flight
   * jobs. NOT tied to subscription tier — see
   * {@link AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_TEAM}.
   */
  activeTeamSlotsRemaining: number;
  backlogThreshold: number;
  belowBacklog: boolean;
  tokenBalance: number;
  ideaCost: number;
  dryRun: boolean;
}

/**
 * Branch order matters — pick the **most specific actionable
 * reason** that describes why the tick produced no work.
 *
 * Customer-facing controls (top up the backlog, raise the daily
 * post target, top up tokens) come BEFORE internal operational
 * throttles (active-job concurrency, token-budget rounding) so
 * the dashboard surfaces the most useful message.
 *
 * The active-job branches surface a `*_limit_reached` reason but
 * are framed as backpressure ("autopilot is waiting for current
 * jobs to finish"), not subscription / plan caps. The next cron
 * tick continues automatically once jobs drain.
 */
function pickSkipReason(input: SkipReasonInput): string {
  if (input.dryRun) return AUTOPILOT_SKIP_REASONS.DRY_RUN;
  if (input.approvedIdeasCount === 0 && input.belowBacklog) {
    // Backlog was below threshold AND we ended the run without
    // generating ideas — the only way that happens (besides dry run)
    // is the team can't afford even a single idea batch.
    if (input.tokenBalance < input.ideaCost) {
      return AUTOPILOT_SKIP_REASONS.INSUFFICIENT_BALANCE;
    }
    return AUTOPILOT_SKIP_REASONS.BACKLOG_EMPTY_NO_BUDGET_FOR_IDEAS;
  }
  if (input.approvedIdeasCount === 0) {
    return AUTOPILOT_SKIP_REASONS.NO_APPROVED_IDEAS_IN_BACKLOG;
  }
  if (input.articleSlotsRemainingToday === 0) {
    return AUTOPILOT_SKIP_REASONS.DAILY_ARTICLE_CAP_REACHED;
  }
  if (input.activeBlogSlotsRemaining === 0) {
    return AUTOPILOT_SKIP_REASONS.ACTIVE_ARTICLE_JOB_LIMIT_REACHED;
  }
  if (input.activeTeamSlotsRemaining === 0) {
    return AUTOPILOT_SKIP_REASONS.ACTIVE_TEAM_ARTICLE_JOB_LIMIT_REACHED;
  }
  /* v8 ignore next 1 -- defensive: covered by other branches in practice */
  if (input.articlesAllowedByTokens === 0) {
    return AUTOPILOT_SKIP_REASONS.INSUFFICIENT_TOKEN_BUDGET;
  }
  /* v8 ignore next 1 -- defensive: should be unreachable when `noWorkDone` is true */
  return AUTOPILOT_SKIP_REASONS.NO_WORK_NEEDED;
}

interface BuildOutputInput {
  reason: string;
  tokenBalance: number;
  tokensSpentToday: number;
  tokensRemainingFromBudget: number | null;
  dailyMaxFromConfig: number;
  articlesStartedToday: number;
  approvedIdeasCount: number;
  articleJobIds: string[];
  dryRun: boolean;
  lastSpawnError?: string | null;
  blogName?: string;
  /**
   * Number of ideas the run flipped from `generated → approved`.
   * Always 0 when `requireReview === true`, and 0 when no new
   * ideas were generated this tick. Surfaced in the recent-runs
   * panel and in dashboards/exports.
   */
  ideasAutoApproved: number;
  /**
   * Snapshot of the gating setting at run time so an operator
   * reading old runs can tell whether auto-approve was off (the
   * scheduler couldn't have approved) vs. on but no ideas were
   * generated this tick.
   */
  requireReview: boolean;
  /**
   * In-flight job snapshot at the moment the tick decided to
   * spawn (or skip) work. Used by the operational backpressure
   * throttles — see {@link AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_BLOG}
   * + {@link AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_TEAM}. NOT
   * subscription / plan caps. Both fields are 0 on early-skip
   * paths that bail before computing them — the keys are still
   * emitted so downstream readers don't have to feature-detect.
   */
  activeJobsForBlog: number;
  activeJobsForTeam: number;
}

function buildOutput(input: BuildOutputInput): Record<string, unknown> {
  return {
    reason: input.reason,
    dryRun: input.dryRun,
    blogName: input.blogName,
    budget: {
      tokenBalance: input.tokenBalance,
      tokensSpentToday: input.tokensSpentToday,
      tokensRemainingFromBudget: input.tokensRemainingFromBudget,
    },
    daily: {
      cap: input.dailyMaxFromConfig,
      articlesStartedToday: input.articlesStartedToday,
    },
    backlog: {
      approvedIdeasAvailable: input.approvedIdeasCount,
    },
    // Internal operational throttle snapshot. The `*Limit` fields
    // are the in-code constants (NOT subscription / plan caps) —
    // surfaced here for debugging cron behavior + future ops
    // dashboards. The recent-runs panel + run drawer don't render
    // this object today; if they ever do, the labels need to
    // stay backpressure-flavored ("autopilot is waiting for
    // current jobs to finish"), not customer-facing limit copy.
    operationalThrottle: {
      blog: {
        activeJobs: input.activeJobsForBlog,
        operationalLimit: AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_BLOG,
      },
      team: {
        activeJobs: input.activeJobsForTeam,
        operationalLimit: AUTOPILOT_OPERATIONAL_ACTIVE_JOBS_PER_TEAM,
      },
    },
    spawnedArticleJobIds: input.articleJobIds,
    ideasAutoApproved: input.ideasAutoApproved,
    requireReview: input.requireReview,
    ...(input.lastSpawnError ? { lastSpawnError: input.lastSpawnError } : {}),
  };
}

async function skip(
  client: Client,
  runId: string,
  reason: string,
): Promise<void> {
  await completeBlogAutopilotRun({
    runId,
    status: "skipped",
    output: { reason },
    client,
  });
}

interface MakeResultExtras {
  ideasGenerated?: number;
  articleJobsStarted?: number;
  articleJobIds?: string[];
  extra?: Record<string, unknown>;
}

function makeResult(
  runId: string,
  status: "completed" | "skipped" | "failed",
  reason: string | null,
  extras: MakeResultExtras = {},
): RunAutopilotForBlogResult {
  return {
    runId,
    status,
    reason,
    ideasGenerated: extras.ideasGenerated ?? 0,
    articleJobsStarted: extras.articleJobsStarted ?? 0,
    articleJobIds: extras.articleJobIds ?? [],
    output: extras.extra ?? {},
  };
}

/**
 * Same shape as the reconciler's helper — Supabase / PostgREST
 * errors are plain `{ message }` objects, not `Error` instances, so
 * `String(...)` would render `[object Object]` in the result's
 * `errors[]`. Lift `.message` when present.
 */
function describeErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}
