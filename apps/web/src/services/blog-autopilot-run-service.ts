import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reusable building blocks for the autopilot scheduler's run / audit
 * log (`public.blog_autopilot_runs`).
 *
 * Three facts shape every helper here:
 *
 *   1. Two callers will use these:
 *        * Today: ad-hoc tests + the future Vercel Cron route handler.
 *        * Tomorrow: the Vercel Workflow runner that actually drives
 *          a single run end-to-end.
 *      Both call the SAME helpers. The workflow gives us durable
 *      retries on top, but the unit of work (insert a run, advance
 *      its step, increment its counters, finish it) is identical.
 *
 *   2. `blog_autopilot_runs` has default-deny RLS — see migration
 *      00019. Helpers default to the admin (service-role) client to
 *      make this Just Work, while still letting tests and the future
 *      cron handler inject their own client.
 *
 *   3. This service intentionally does NOT spawn `article_jobs` or
 *      call the AI provider. It owns the *meta-record* — when did
 *      autopilot run, what did it decide, what counters does the
 *      dashboard show. The article-generation pipeline keeps its own
 *      job rows. A future workflow ties the two together by stamping
 *      `article_jobs.input.autopilot_run_id` so the per-blog ops
 *      drawer can drill from a run into the jobs it spawned.
 */

type Client = SupabaseClient<Database>;

// ----------------------------------------------------------------------------
// Status / step / source constants. The DB stores them as plain text +
// check constraints; these constants are the TS source of truth so a
// typo in app code fails at compile time, not at runtime.
// ----------------------------------------------------------------------------

export const BLOG_AUTOPILOT_RUN_TRIGGER_SOURCES = [
  "cron",
  "manual",
  "workflow",
  "system",
] as const;
export type BlogAutopilotRunTriggerSource =
  (typeof BLOG_AUTOPILOT_RUN_TRIGGER_SOURCES)[number];

export const BLOG_AUTOPILOT_RUN_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
  "skipped",
] as const;
export type BlogAutopilotRunStatus =
  (typeof BLOG_AUTOPILOT_RUN_STATUSES)[number];

/**
 * Free-form inside the DB (the workflow grows new step names without a
 * migration). The known set is enumerated here so the orchestration
 * code at least has compile-time checking, but
 * {@link updateBlogAutopilotRunStatus} accepts arbitrary strings for
 * forward compatibility.
 */
export const BLOG_AUTOPILOT_RUN_STEPS = [
  "loading_settings",
  "checking_budget",
  "checking_backlog",
  "generating_ideas",
  "generating_articles",
  "completed",
] as const;
export type BlogAutopilotRunStep = (typeof BLOG_AUTOPILOT_RUN_STEPS)[number];

/**
 * Counter delta accepted by {@link updateBlogAutopilotRunStatus} and
 * {@link completeBlogAutopilotRun}. Each field is added (not set) to
 * the existing row so partial progress accumulates as the workflow
 * walks through its steps.
 *
 * All deltas must be non-negative — autopilot runs only ever add to
 * these counters. A negative delta would corrupt the dashboard view of
 * "how many articles did this run actually finish".
 */
export interface BlogAutopilotRunCounterDelta {
  ideasGenerated?: number;
  articlesStarted?: number;
  articlesCompleted?: number;
  articlesFailed?: number;
  tokensSpent?: number;
  tokensRefunded?: number;
}

const COUNTER_COLUMNS: Array<{
  key: keyof BlogAutopilotRunCounterDelta;
  column: keyof Tables<"blog_autopilot_runs">;
}> = [
  { key: "ideasGenerated", column: "ideas_generated" },
  { key: "articlesStarted", column: "articles_started" },
  { key: "articlesCompleted", column: "articles_completed" },
  { key: "articlesFailed", column: "articles_failed" },
  { key: "tokensSpent", column: "tokens_spent" },
  { key: "tokensRefunded", column: "tokens_refunded" },
];

function validateDelta(delta: BlogAutopilotRunCounterDelta): void {
  for (const { key } of COUNTER_COLUMNS) {
    const v = delta[key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new Error(
        `Invalid autopilot run counter delta for "${key}": ${String(v)} (must be a non-negative finite number)`,
      );
    }
  }
}

/**
 * Returns true if any counter delta key is present (with a defined
 * value, including 0). We need this rather than "any value > 0" so a
 * caller passing `{ articlesFailed: 0 }` for symmetry with the success
 * path doesn't accidentally trigger a no-op read of the row.
 */
function hasCounterDelta(delta: BlogAutopilotRunCounterDelta): boolean {
  for (const { key } of COUNTER_COLUMNS) {
    if (delta[key] !== undefined) return true;
  }
  return false;
}

/**
 * Builds a `TablesUpdate<"blog_autopilot_runs">` patch that adds the
 * given delta to the row's existing counters. Because PostgREST has no
 * `UPDATE ... SET col = col + n` shortcut, we read the current row and
 * compute the new values in-memory.
 *
 * Read-then-write race window: a single autopilot run is only ever
 * touched by ONE workflow execution at a time (the workflow runner
 * holds the lock for the duration of the run). If we ever introduce
 * parallel updates to the same run, this will need to move into a
 * Postgres `security definer` RPC like `grant_tokens` does.
 */
async function readCountersForDelta(
  supabase: Client,
  runId: string,
  delta: BlogAutopilotRunCounterDelta,
): Promise<TablesUpdate<"blog_autopilot_runs">> {
  const { data, error } = await supabase
    .from("blog_autopilot_runs")
    .select(
      "ideas_generated, articles_started, articles_completed, articles_failed, tokens_spent, tokens_refunded",
    )
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(
      `Autopilot run ${runId} not found while incrementing counters`,
    );
  }

  const update: TablesUpdate<"blog_autopilot_runs"> = {};
  for (const { key, column } of COUNTER_COLUMNS) {
    const add = delta[key];
    if (add === undefined) continue;
    const current = (data as Record<string, number>)[column] ?? 0;
    (update as Record<string, number>)[column] = current + add;
  }
  return update;
}

// ----------------------------------------------------------------------------
// blog_autopilot_runs helpers
// ----------------------------------------------------------------------------

export interface CreateBlogAutopilotRunInput {
  teamId: string;
  projectId: string;
  blogId: string;
  /** Defaults to `cron`. */
  triggerSource?: BlogAutopilotRunTriggerSource;
  /**
   * The user who manually kicked the run (only meaningful when
   * `triggerSource === "manual"`). Null otherwise.
   */
  triggeredByUserId?: string | null;
  /**
   * Optional initial status. Defaults to `pending`; the workflow
   * runner may want to insert directly as `processing` to skip a
   * round-trip.
   */
  status?: BlogAutopilotRunStatus;
  /**
   * Optional first step name. Useful when seeding directly into
   * `processing` so the dashboard shows the current step from the
   * very first read.
   */
  currentStep?: BlogAutopilotRunStep | (string & {});
  /** When the run is due to start. Null = "as soon as possible". */
  scheduledFor?: Date | string | null;
  /** Free-form inputs (settings snapshot, budget cap, backlog count). */
  input?: Record<string, unknown>;
  client?: Client;
}

/**
 * Inserts a new `blog_autopilot_runs` row. Returns the full row so
 * callers have the id for later step updates and a known
 * `created_at`.
 */
export async function createBlogAutopilotRun(
  input: CreateBlogAutopilotRunInput,
): Promise<Tables<"blog_autopilot_runs">> {
  const supabase = input.client ?? createAdminClient();

  const row: TablesInsert<"blog_autopilot_runs"> = {
    team_id: input.teamId,
    project_id: input.projectId,
    blog_id: input.blogId,
    triggered_by_user_id: input.triggeredByUserId ?? null,
    trigger_source: input.triggerSource ?? "cron",
    status: input.status ?? "pending",
    current_step: input.currentStep ?? null,
    scheduled_for: toIsoOrNull(input.scheduledFor),
    input: (input.input ?? {}) as Json,
  };

  const { data, error } = await supabase
    .from("blog_autopilot_runs")
    .insert(row)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export interface UpdateBlogAutopilotRunStatusInput {
  runId: string;
  status?: BlogAutopilotRunStatus;
  /** Free-form to allow new step names without a code change. */
  currentStep?: BlogAutopilotRunStep | (string & {});
  errorMessage?: string;
  /**
   * Increment counters as part of the same write. Useful when the
   * workflow finishes a step and wants to advance both `current_step`
   * and "we now have N more articles started" in one round-trip.
   */
  countersDelta?: BlogAutopilotRunCounterDelta;
  client?: Client;
}

/**
 * Generic step / status patch. Auto-stamps `started_at` the first time
 * the run moves into `processing` so the dashboard can show "running
 * for X seconds" without a separate write.
 */
export async function updateBlogAutopilotRunStatus(
  input: UpdateBlogAutopilotRunStatusInput,
): Promise<void> {
  const supabase = input.client ?? createAdminClient();

  const update: TablesUpdate<"blog_autopilot_runs"> = {};
  if (input.status !== undefined) update.status = input.status;
  if (input.currentStep !== undefined) update.current_step = input.currentStep;
  if (input.errorMessage !== undefined) {
    update.error_message = input.errorMessage;
  }

  if (input.status === "processing") {
    // Always re-stamp on every transition to processing — the workflow
    // may retry, and the most recent processing time is the one the
    // queue UI cares about.
    update.started_at = new Date().toISOString();
  }

  if (input.countersDelta) {
    validateDelta(input.countersDelta);
    if (hasCounterDelta(input.countersDelta)) {
      const counterPatch = await readCountersForDelta(
        supabase,
        input.runId,
        input.countersDelta,
      );
      Object.assign(update, counterPatch);
    }
  }

  if (Object.keys(update).length === 0) {
    // Nothing to do — bail out instead of issuing an empty UPDATE that
    // would still bump `updated_at` via the trigger.
    return;
  }

  const { error } = await supabase
    .from("blog_autopilot_runs")
    .update(update)
    .eq("id", input.runId);

  if (error) throw error;
}

export interface CompleteBlogAutopilotRunInput {
  runId: string;
  /**
   * Optional final status — defaults to `completed`. Pass `skipped`
   * when the run finished cleanly but produced no work (backlog
   * already full, daily budget already spent, autopilot disabled,
   * etc.). The dashboard treats both as "successful endings".
   */
  status?: Extract<BlogAutopilotRunStatus, "completed" | "skipped">;
  /** Final outputs (jobs spawned, model names, decision rationale). */
  output?: Record<string, unknown>;
  /** Counters to add on completion (e.g. final tally of refunds). */
  countersDelta?: BlogAutopilotRunCounterDelta;
  client?: Client;
}

/**
 * Marks a run successful. Sets the final status (default `completed`),
 * stamps `current_step='completed'` and `completed_at`. Optionally
 * folds in last-mile counter deltas.
 */
export async function completeBlogAutopilotRun(
  input: CompleteBlogAutopilotRunInput,
): Promise<void> {
  const supabase = input.client ?? createAdminClient();

  const finalStatus: BlogAutopilotRunStatus = input.status ?? "completed";

  const update: TablesUpdate<"blog_autopilot_runs"> = {
    status: finalStatus,
    current_step: "completed",
    completed_at: new Date().toISOString(),
  };
  if (input.output !== undefined) update.output = input.output as Json;

  if (input.countersDelta) {
    validateDelta(input.countersDelta);
    if (hasCounterDelta(input.countersDelta)) {
      const counterPatch = await readCountersForDelta(
        supabase,
        input.runId,
        input.countersDelta,
      );
      Object.assign(update, counterPatch);
    }
  }

  const { error } = await supabase
    .from("blog_autopilot_runs")
    .update(update)
    .eq("id", input.runId);

  if (error) throw error;
}

export interface FailBlogAutopilotRunInput {
  runId: string;
  errorMessage: string;
  /** Whatever output was produced before failing (partial counters, etc.). */
  output?: Record<string, unknown>;
  /** Counters to add on failure (e.g. tokens already refunded). */
  countersDelta?: BlogAutopilotRunCounterDelta;
  client?: Client;
}

/**
 * Marks a run failed. Sets `status='failed'`, stamps `error_message`
 * and `completed_at`. Leaves `current_step` alone so the dashboard
 * can show "failed during generating_articles".
 */
export async function failBlogAutopilotRun(
  input: FailBlogAutopilotRunInput,
): Promise<void> {
  const supabase = input.client ?? createAdminClient();

  const update: TablesUpdate<"blog_autopilot_runs"> = {
    status: "failed",
    error_message: input.errorMessage,
    completed_at: new Date().toISOString(),
  };
  if (input.output !== undefined) update.output = input.output as Json;

  if (input.countersDelta) {
    validateDelta(input.countersDelta);
    if (hasCounterDelta(input.countersDelta)) {
      const counterPatch = await readCountersForDelta(
        supabase,
        input.runId,
        input.countersDelta,
      );
      Object.assign(update, counterPatch);
    }
  }

  const { error } = await supabase
    .from("blog_autopilot_runs")
    .update(update)
    .eq("id", input.runId);

  if (error) throw error;
}

export interface ListBlogAutopilotRunsForBlogOptions {
  /** Most-recent-first, capped at 50 by default. */
  limit?: number;
  /** Filter by status (e.g. `["failed"]` for a failure-rate query). */
  statuses?: readonly BlogAutopilotRunStatus[];
  client?: Client;
}

const DEFAULT_RUN_LIST_LIMIT = 25;
const MAX_RUN_LIST_LIMIT = 200;

/**
 * Returns the most-recent autopilot runs for a blog, newest first.
 *
 * Defaults to 25 rows (matches the per-blog ops drawer page size).
 * Caller can request more, but we cap at {@link MAX_RUN_LIST_LIMIT}
 * so a misconfigured page request can't dump the whole audit log.
 */
export async function listBlogAutopilotRunsForBlog(
  blogId: string,
  options: ListBlogAutopilotRunsForBlogOptions = {},
): Promise<Tables<"blog_autopilot_runs">[]> {
  const supabase = options.client ?? createAdminClient();
  const limit = clampLimit(options.limit ?? DEFAULT_RUN_LIST_LIMIT);

  let query = supabase
    .from("blog_autopilot_runs")
    .select("*")
    .eq("blog_id", blogId);

  if (options.statuses && options.statuses.length > 0) {
    query = query.in("status", options.statuses as unknown as string[]);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RUN_LIST_LIMIT;
  return Math.min(Math.floor(n), MAX_RUN_LIST_LIMIT);
}

// ----------------------------------------------------------------------------
// Per-run detail loader (for the recent-runs drawer)
// ----------------------------------------------------------------------------

/**
 * Compact view-model the detail drawer renders. We project the
 * underlying tables into a narrower shape so the wire payload stays
 * small AND the UI doesn't need to know about every column.
 */
export interface BlogAutopilotRunDetailJob {
  id: string;
  type: string;
  status: string;
  currentStep: string | null;
  errorMessage: string | null;
  input: Json | null;
  output: Json | null;
  articleId: string | null;
  articleIdeaId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface BlogAutopilotRunDetailArticle {
  id: string;
  title: string;
  slug: string | null;
  status: string;
  wordCount: number | null;
  targetKeyword: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlogAutopilotRunDetailIdea {
  id: string;
  title: string;
  status: string;
  targetKeyword: string | null;
  executiveSummary: string | null;
  createdAt: string;
}

export interface BlogAutopilotRunDetail {
  run: Tables<"blog_autopilot_runs">;
  /** Article jobs whose `input.autopilotRunId` equals this run's id. */
  jobs: BlogAutopilotRunDetailJob[];
  /** Articles referenced by `jobs[i].articleId`. Newest-first. */
  articles: BlogAutopilotRunDetailArticle[];
  /** Ideas referenced by `jobs[i].articleIdeaId`. Newest-first. */
  ideas: BlogAutopilotRunDetailIdea[];
}

export interface GetBlogAutopilotRunDetailInput {
  blogId: string;
  runId: string;
  client?: Client;
}

/**
 * Loads the full audit picture for a single autopilot run:
 *
 *   1. The run row itself (scoped to `blog_id` so a stray
 *      project_id swap can't surface another team's data).
 *   2. Every `article_jobs` row linked back to this run via
 *      `input.autopilotRunId` (only the autopilot scheduler
 *      stamps that key).
 *   3. The articles + ideas those jobs reference, in two follow-up
 *      `IN (...)` queries. Two extra round-trips, but PostgREST
 *      resource-embed syntax doesn't compose well across jsonb
 *      filters, so this is the more boring + more debuggable path.
 *
 * Returns `null` when the run doesn't exist or doesn't belong to
 * the supplied `blogId` — the caller's action then renders a
 * "not found" state without leaking row existence to other teams.
 */
export async function getBlogAutopilotRunDetail(
  input: GetBlogAutopilotRunDetailInput,
): Promise<BlogAutopilotRunDetail | null> {
  const supabase = input.client ?? createAdminClient();

  // 1. The run row, scoped to blog_id (defense in depth — RLS already
  //    filters by team membership, but action callers pass blogId
  //    explicitly so we double-check).
  const { data: run, error: runErr } = await supabase
    .from("blog_autopilot_runs")
    .select("*")
    .eq("id", input.runId)
    .eq("blog_id", input.blogId)
    .maybeSingle();
  if (runErr) throw runErr;
  if (!run) return null;

  // 2. Every article_jobs row whose input jsonb mentions this run.
  //    The scheduler stamps `input.autopilotRunId = run.id` for both
  //    `generate_ideas` and `generate_article` jobs, so a single
  //    `input->>autopilotRunId` filter catches the whole graph.
  const { data: jobRows, error: jobsErr } = await supabase
    .from("article_jobs")
    .select(
      "id, type, status, current_step, error_message, input, output, article_id, article_idea_id, created_at, started_at, completed_at",
    )
    .eq("blog_id", input.blogId)
    .filter("input->>autopilotRunId", "eq", input.runId)
    .order("created_at", { ascending: true });
  if (jobsErr) throw jobsErr;
  const jobs: BlogAutopilotRunDetailJob[] = (jobRows ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    currentStep: row.current_step,
    errorMessage: row.error_message,
    input: row.input,
    output: row.output,
    articleId: row.article_id,
    articleIdeaId: row.article_idea_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }));

  // 3. Two follow-up loads: articles + ideas the jobs reference.
  //    Skipping the IN(...) query when the list is empty avoids a
  //    no-op round-trip (PostgREST returns 400 on empty `in` lists).
  const articleIds = unique(
    jobs.map((j) => j.articleId).filter(isNonNull),
  );
  const ideaIds = unique(
    jobs.map((j) => j.articleIdeaId).filter(isNonNull),
  );

  const articles = await loadArticles(supabase, input.blogId, articleIds);
  const ideas = await loadIdeas(supabase, input.blogId, ideaIds);

  return { run, jobs, articles, ideas };
}

async function loadArticles(
  client: Client,
  blogId: string,
  ids: string[],
): Promise<BlogAutopilotRunDetailArticle[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from("articles")
    .select(
      "id, title, slug, status, word_count, target_keyword, created_at, updated_at",
    )
    .eq("blog_id", blogId)
    .in("id", ids)
    .order("created_at", { ascending: false });
  if (error) throw error;
  /* v8 ignore next 1 -- defensive: PostgREST returns array on success */
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    wordCount: row.word_count,
    targetKeyword: row.target_keyword,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function loadIdeas(
  client: Client,
  blogId: string,
  ids: string[],
): Promise<BlogAutopilotRunDetailIdea[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from("article_ideas")
    .select(
      "id, title, status, target_keyword, executive_summary, created_at",
    )
    .eq("blog_id", blogId)
    .in("id", ids)
    .order("created_at", { ascending: false });
  if (error) throw error;
  /* v8 ignore next 1 -- defensive: PostgREST returns array on success */
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    targetKeyword: row.target_keyword,
    executiveSummary: row.executive_summary,
    createdAt: row.created_at,
  }));
}

function unique<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function isNonNull<T>(x: T | null | undefined): x is T {
  return x !== null && x !== undefined;
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}
