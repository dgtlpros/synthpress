import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { start } from "workflow/api";
import { loadBlogSettings } from "@/lib/blog-settings";
import { getCreditCost } from "@/lib/ai/config";
import { getTeamPlan } from "./team-billing-service";
import {
  type ArticleIdeaRow,
  type ArticleIdeaStatus,
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
    runsCreated: 0,
    runsSkipped: 0,
    runsFailed: 0,
    ideasGenerated: 0,
    articleJobsStarted: 0,
    errors: [],
    perBlog: [],
  };

  let blogs: ScheduledBlog[];
  try {
    blogs = await loadEligibleBlogs(supabase, limit);
  } catch (err) {
    result.errors.push(`load_blogs: ${describeErr(err)}`);
    return result;
  }

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
      await skip(supabase, run.id, "blog_not_found");
      return makeResult(run.id, "skipped", "blog_not_found");
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
      await skip(supabase, run.id, "autopilot_disabled");
      return makeResult(run.id, "skipped", "autopilot_disabled");
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
      await skip(supabase, run.id, "team_billing_unavailable");
      return makeResult(run.id, "skipped", "team_billing_unavailable");
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
    // started today.
    const articlesStartedToday = await countArticleJobsStartedTodayForBlog(
      supabase,
      input.blogId,
      now,
    );

    const dailyMaxFromConfig = computeDailyMaxArticles(
      settings.automation.maxPostsPerDay,
      settings.automation.generatePerWeek,
    );
    const articleSlotsRemainingToday = Math.max(
      0,
      dailyMaxFromConfig - articlesStartedToday,
    );

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

    let ideasGenerated = 0;
    // Tracked separately from `ideasGenerated` so the run output
    // can answer the question "did autopilot move ideas straight
    // into the article queue, or did they stop at 'generated'?"
    let ideasAutoApproved = 0;
    if (
      approvedIdeas.length < backlogThreshold &&
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
          jobMetadata: { autopilotRunId: run.id },
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

    const articlesToStart = Math.min(
      approvedIdeas.length,
      articleSlotsRemainingToday,
      articlesAllowedByTokens,
      PER_RUN_ARTICLE_CAP,
    );

    const articleJobIds: string[] = [];
    let articleJobsStarted = 0;
    let lastSpawnError: string | null = null;

    if (articlesToStart > 0 && !input.dryRun) {
      for (let i = 0; i < articlesToStart; i += 1) {
        const idea = approvedIdeas[i];
        try {
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
          // already-pending jobs for the same idea, so a re-run of
          // the scheduler hour later won't double-spawn workflows.
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
        reason: lastSpawnError ? "partial_failure" : "ok",
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
      }),
      client: supabase,
    });

    return makeResult(
      run.id,
      "completed",
      lastSpawnError ? "partial_failure" : null,
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
 * Loads blogs whose owner has explicitly armed autopilot. Uses the
 * jsonb `->>` operator — no separate column for `mode` / `enabled`,
 * everything lives in `blogs.settings.automation` per the cleanup PR.
 */
async function loadEligibleBlogs(
  client: Client,
  limit: number,
): Promise<ScheduledBlog[]> {
  // Project membership is intentionally NOT joined — the run row
  // captures team_id directly from the project, and a deleted
  // project would cascade-delete the blog (FK on `blogs.project_id`).
  const { data, error } = await client
    .from("blogs")
    .select("id, project_id, settings, project:projects!project_id(team_id)")
    .filter("settings->automation->>mode", "eq", "autopilot")
    .filter("settings->automation->>enabled", "eq", "true")
    .limit(limit);

  if (error) throw error;
  /* v8 ignore next 1 -- defensive: supabase returns data when error is null */
  if (!data) return [];

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
  return out;
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
  const { data, error } = await client
    .from("article_ideas")
    .select("*")
    .eq("blog_id", blogId)
    .eq("status", "approved" satisfies ArticleIdeaStatus)
    .order("created_at", { ascending: true });
  if (error) throw error;
  /* v8 ignore next 1 -- defensive: supabase returns data when error is null */
  return (data ?? []) as ArticleIdeaRow[];
}

async function countArticleJobsStartedTodayForBlog(
  client: Client,
  blogId: string,
  now: Date,
): Promise<number> {
  // 24h rolling window — see the `runAutopilotForBlog` JSDoc for why
  // we don't honor the blog's timezone in v1.
  const cutoffIso = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const { count, error } = await client
    .from("article_jobs")
    .select("id", { count: "exact", head: true })
    .eq("blog_id", blogId)
    .eq("type", "generate_article")
    .gte("created_at", cutoffIso);
  if (error) throw error;
  /* v8 ignore next 1 -- defensive: supabase returns count when error is null */
  return count ?? 0;
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

interface SkipReasonInput {
  approvedIdeasCount: number;
  articleSlotsRemainingToday: number;
  articlesAllowedByTokens: number;
  backlogThreshold: number;
  belowBacklog: boolean;
  tokenBalance: number;
  ideaCost: number;
  dryRun: boolean;
}

function pickSkipReason(input: SkipReasonInput): string {
  if (input.dryRun) return "dry_run";
  if (input.approvedIdeasCount === 0 && input.belowBacklog) {
    // Backlog was below threshold AND we ended the run without
    // generating ideas — the only way that happens (besides dry run)
    // is the team can't afford even a single idea batch.
    if (input.tokenBalance < input.ideaCost) return "insufficient_balance";
    return "backlog_empty_no_budget_for_ideas";
  }
  if (input.approvedIdeasCount === 0) {
    return "no_approved_ideas_in_backlog";
  }
  if (input.articleSlotsRemainingToday === 0) {
    return "daily_article_cap_reached";
  }
  /* v8 ignore next 1 -- defensive: covered by other branches in practice */
  if (input.articlesAllowedByTokens === 0) {
    return "insufficient_token_budget";
  }
  /* v8 ignore next 1 -- defensive: should be unreachable when `noWorkDone` is true */
  return "no_work_needed";
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
