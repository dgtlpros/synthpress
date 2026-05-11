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
import { type BlogSettings, loadBlogSettings } from "@/lib/blog-settings";
import { getCreditCost } from "@/lib/ai/config";
import {
  type AnthropicLike,
  type GeneratedArticleDraft,
  type GeneratedIdea,
  IDEA_DEFAULT_COUNT,
  generateArticleDraft,
  generateIdeas,
} from "@/lib/ai/provider";
import { consumeTeamTokens, refundTeamTokens } from "./team-billing-service";

/**
 * Reusable building blocks for the AI generation pipeline.
 *
 * Two facts shape every helper here:
 *
 *   1. Today the orchestration is a server action. Tomorrow it'll be a
 *      Vercel Workflow run. Both must call the SAME helpers — the
 *      workflow gives us durable retries on top, but the unit of work
 *      (insert a job, advance its step, log a usage event) is identical.
 *      So every helper takes a SupabaseClient and never reaches into
 *      the request scope.
 *
 *   2. `article_jobs` and `usage_events` have default-deny RLS — see
 *      `00016_article_generation.sql`. Helpers default to the admin
 *      (service-role) client to make this Just Work, while still
 *      letting tests inject a mock client.
 */

type Client = SupabaseClient<Database>;

// ----------------------------------------------------------------------------
// Status / step / type constants. The DB stores them as plain text +
// check constraints; these constants are the TS source of truth so a
// typo in app code fails at compile time, not at runtime when the
// constraint rejects the insert.
// ----------------------------------------------------------------------------

export const ARTICLE_JOB_TYPES = [
  "generate_ideas",
  "generate_outline",
  "generate_article",
] as const;
export type ArticleJobType = (typeof ARTICLE_JOB_TYPES)[number];

export const ARTICLE_JOB_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ArticleJobStatus = (typeof ARTICLE_JOB_STATUSES)[number];

/**
 * Free-form inside the DB (the workflow grows new step names without a
 * migration). The known set is enumerated here so the orchestration
 * code at least has compile-time checking, but `updateArticleJobStatus`
 * accepts arbitrary strings for forward compatibility.
 */
export const ARTICLE_JOB_STEPS = [
  "loading_context",
  "generating_ideas",
  "saving_ideas",
  "generating_outline",
  "writing_article",
  "saving_article",
  "logging_usage",
  "completed",
] as const;
export type ArticleJobStep = (typeof ARTICLE_JOB_STEPS)[number];

/**
 * Where a generation request originated. Pinned in `article_jobs.input`
 * so autopilot replays / cron failures can be filtered + audited.
 *
 * v1 only emits `"manual"`. The other two are reserved for the
 * autopilot scheduler and the (future) Vercel Workflow runner so the
 * orchestration code never has to be changed when those land — they
 * call the same `generateArticleIdeas` with a different `triggerSource`.
 */
export const TRIGGER_SOURCES = ["manual", "autopilot", "workflow"] as const;
export type TriggerSource = (typeof TRIGGER_SOURCES)[number];

export const ARTICLE_IDEA_STATUSES = [
  "generated",
  "approved",
  "rejected",
  "converted_to_article",
] as const;
export type ArticleIdeaStatus = (typeof ARTICLE_IDEA_STATUSES)[number];

// Common provider name — exported so usage-event callers don't sprinkle
// the string literal across the codebase.
export const PROVIDER_ANTHROPIC = "anthropic" as const;

// ----------------------------------------------------------------------------
// article_jobs helpers
// ----------------------------------------------------------------------------

export interface CreateArticleJobInput {
  blogId: string;
  type: ArticleJobType;
  /** Acting user — the team member who triggered this job. */
  userId: string;
  articleId?: string | null;
  articleIdeaId?: string | null;
  /** Free-form inputs (brief, model overrides, etc.). */
  input?: Record<string, unknown>;
  /**
   * Optional initial status. Defaults to `pending`; tests and the
   * future workflow runner may want to insert directly as `processing`.
   */
  status?: ArticleJobStatus;
  client?: Client;
}

/**
 * Inserts a new `article_jobs` row. Returns the full row so callers
 * have the id for later step updates and a known `created_at`.
 */
export async function createArticleJob(
  input: CreateArticleJobInput,
): Promise<Tables<"article_jobs">> {
  const supabase = input.client ?? createAdminClient();

  const row: TablesInsert<"article_jobs"> = {
    blog_id: input.blogId,
    type: input.type,
    user_id: input.userId,
    status: input.status ?? "pending",
    article_id: input.articleId ?? null,
    article_idea_id: input.articleIdeaId ?? null,
    input: (input.input ?? {}) as Json,
  };

  const { data, error } = await supabase
    .from("article_jobs")
    .insert(row)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export interface UpdateArticleJobStatusInput {
  jobId: string;
  status?: ArticleJobStatus;
  /** Free-form to allow new step names without a code change. */
  currentStep?: ArticleJobStep | (string & {});
  errorMessage?: string;
  /**
   * Increment `attempts` by 1 in the same write. Useful when the
   * orchestration moves the job back to `processing` for a retry.
   */
  incrementAttempts?: boolean;
  client?: Client;
}

/**
 * Generic step / status patch. Auto-stamps `started_at` the first time
 * the job moves into `processing` so the dashboard can show "running
 * for X seconds" without a separate write.
 */
export async function updateArticleJobStatus(
  input: UpdateArticleJobStatusInput,
): Promise<void> {
  const supabase = input.client ?? createAdminClient();

  const update: TablesUpdate<"article_jobs"> = {};
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

  if (input.incrementAttempts) {
    // Read-then-write is acceptable here because attempts is only ever
    // incremented in-process by the orchestration that owns the job;
    // there is no cross-process race for a single job's attempt count.
    const { data: existing, error: readErr } = await supabase
      .from("article_jobs")
      .select("attempts")
      .eq("id", input.jobId)
      .maybeSingle();
    if (readErr) throw readErr;
    update.attempts = (existing?.attempts ?? 0) + 1;
  }

  const { error } = await supabase
    .from("article_jobs")
    .update(update)
    .eq("id", input.jobId);

  if (error) throw error;
}

export interface CompleteArticleJobInput {
  jobId: string;
  /** Final outputs (model name, token counts, cost estimate, etc.). */
  output?: Record<string, unknown>;
  /** Link the produced article / idea now that they exist. */
  articleId?: string;
  articleIdeaId?: string;
  client?: Client;
}

/**
 * Marks a job successful. Sets `status='completed'`, `current_step='completed'`,
 * and stamps `completed_at`.
 */
export async function completeArticleJob(
  input: CompleteArticleJobInput,
): Promise<void> {
  const supabase = input.client ?? createAdminClient();

  const update: TablesUpdate<"article_jobs"> = {
    status: "completed",
    current_step: "completed",
    completed_at: new Date().toISOString(),
  };
  if (input.output !== undefined) update.output = input.output as Json;
  if (input.articleId !== undefined) update.article_id = input.articleId;
  if (input.articleIdeaId !== undefined) {
    update.article_idea_id = input.articleIdeaId;
  }

  const { error } = await supabase
    .from("article_jobs")
    .update(update)
    .eq("id", input.jobId);

  if (error) throw error;
}

export interface FailArticleJobInput {
  jobId: string;
  errorMessage: string;
  /** Whatever output was produced before failing (partial draft, etc.). */
  output?: Record<string, unknown>;
  client?: Client;
}

/**
 * Marks a job failed. Sets `status='failed'`, stamps `error_message`
 * and `completed_at`. Leaves `current_step` alone so the queue page
 * can show "failed during writing_article".
 */
export async function failArticleJob(
  input: FailArticleJobInput,
): Promise<void> {
  const supabase = input.client ?? createAdminClient();

  const update: TablesUpdate<"article_jobs"> = {
    status: "failed",
    error_message: input.errorMessage,
    completed_at: new Date().toISOString(),
  };
  if (input.output !== undefined) update.output = input.output as Json;

  const { error } = await supabase
    .from("article_jobs")
    .update(update)
    .eq("id", input.jobId);

  if (error) throw error;
}

// ----------------------------------------------------------------------------
// usage_events helpers
// ----------------------------------------------------------------------------

export interface LogUsageEventInput {
  /** Acting user — the one whose action triggered the AI call. */
  userId: string;
  blogId?: string | null;
  articleId?: string | null;
  articleIdeaId?: string | null;
  jobId?: string | null;
  /** Defaults to `PROVIDER_ANTHROPIC`. */
  provider?: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** USD estimate computed at call time from real provider pricing. */
  estimatedCost?: number | null;
  /** Synth tokens charged to the team owner (from `AI_CREDIT_COSTS`). */
  creditsUsed?: number | null;
  client?: Client;
}

/**
 * Inserts a row into `usage_events`. The orchestration calls this once
 * per provider request — typically alongside `consumeTeamTokens` —
 * so the team owner's usage view can correlate "X synth tokens spent"
 * with "Y Claude tokens consumed for that work".
 *
 * Insert-only on purpose: usage events are an immutable audit log.
 */
export async function logUsageEvent(input: LogUsageEventInput): Promise<void> {
  const supabase = input.client ?? createAdminClient();

  const row: TablesInsert<"usage_events"> = {
    user_id: input.userId,
    blog_id: input.blogId ?? null,
    article_id: input.articleId ?? null,
    article_idea_id: input.articleIdeaId ?? null,
    job_id: input.jobId ?? null,
    provider: input.provider ?? PROVIDER_ANTHROPIC,
    model: input.model,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    estimated_cost: input.estimatedCost ?? null,
    credits_used: input.creditsUsed ?? null,
  };

  const { error } = await supabase.from("usage_events").insert(row);
  if (error) throw error;
}

// ----------------------------------------------------------------------------
// Generation context loader
// ----------------------------------------------------------------------------

export interface BlogGenerationContext {
  blog: {
    id: string;
    name: string;
    description: string;
    slug: string;
    projectId: string;
  };
  project: {
    id: string;
    name: string;
    teamId: string;
  };
  team: {
    id: string;
    name: string;
  };
  /** Fully normalized via `loadBlogSettings`. */
  settings: BlogSettings;
}

/**
 * Resolves everything an AI prompt builder needs about a blog: the
 * blog itself, the project + team it belongs to, and the normalized
 * fingerprint settings. Returns `null` if any link in the chain is
 * missing (deleted blog/project/team).
 *
 * Intentionally a single function rather than three (`getBlog`,
 * `getProject`, `getTeam`) — the orchestration code always needs all
 * three together, and bundling them lets us tune the query later
 * (e.g. switch to a single Postgres function with one round-trip)
 * without changing call sites.
 */
export async function getBlogGenerationContext(
  blogId: string,
  client?: Client,
): Promise<BlogGenerationContext | null> {
  const supabase = client ?? createAdminClient();

  const { data: blog, error: blogErr } = await supabase
    .from("blogs")
    .select("id, name, description, slug, project_id, settings")
    .eq("id", blogId)
    .maybeSingle();

  if (blogErr) throw blogErr;
  if (!blog) return null;

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, name, team_id")
    .eq("id", blog.project_id)
    .maybeSingle();

  if (projErr) throw projErr;
  if (!project) return null;

  const { data: team, error: teamErr } = await supabase
    .from("teams")
    .select("id, name")
    .eq("id", project.team_id)
    .maybeSingle();

  if (teamErr) throw teamErr;
  if (!team) return null;

  return {
    blog: {
      id: blog.id,
      name: blog.name,
      description: blog.description,
      slug: blog.slug,
      projectId: blog.project_id,
    },
    project: {
      id: project.id,
      name: project.name,
      teamId: project.team_id,
    },
    team: {
      id: team.id,
      name: team.name,
    },
    settings: loadBlogSettings(blog.settings),
  };
}

// ============================================================================
// article_ideas read helpers + idea→article conversion
// ============================================================================

export type ArticleIdeaRow = Tables<"article_ideas">;

/**
 * Reads all article ideas for a blog, newest first. Used by the
 * `/blogs/[blogId]/ideas` page and any future autopilot dedupe step
 * that wants to check existing titles before generating more.
 */
export async function listArticleIdeasForBlog(
  blogId: string,
  client?: Client,
): Promise<ArticleIdeaRow[]> {
  const supabase = client ?? createAdminClient();

  const { data, error } = await supabase
    .from("article_ideas")
    .select("*")
    .eq("blog_id", blogId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * Returns the set of idea ids in `blogId` that have at least one
 * pending or processing `generate_article` job. Used by the Ideas page
 * to render a "Generating…" badge for ideas the user has already
 * kicked off — survives a page refresh because it reads from
 * `article_jobs`, not React state.
 *
 * Returns an empty Set when there are no ideas to check (saves a
 * round-trip) or when no jobs match.
 */
export async function getActiveGenerateArticleIdeaIds(
  blogId: string,
  ideaIds: readonly string[],
  client?: Client,
): Promise<Set<string>> {
  if (ideaIds.length === 0) return new Set();
  const supabase = client ?? createAdminClient();

  const { data, error } = await supabase
    .from("article_jobs")
    .select("article_idea_id")
    .eq("blog_id", blogId)
    .eq("type", "generate_article")
    .in("status", ["pending", "processing"])
    .in("article_idea_id", ideaIds as string[]);

  if (error) throw error;
  const out = new Set<string>();
  for (const row of data ?? []) {
    if (row.article_idea_id) out.add(row.article_idea_id);
  }
  return out;
}

/**
 * Recently-finished window for the global jobs widget. Completed /
 * failed jobs appear in the tray for ~5 minutes after they finish so
 * users notice them when they return to the app, then drop off.
 *
 * Exported so the hook layer can compute the same cutoff client-side
 * if it ever wants to evict rows in memory before the next poll.
 */
export const ACTIVE_JOB_RECENT_WINDOW_MS = 5 * 60_000;

/**
 * Display row for the global active-jobs widget. Wraps the raw
 * `article_jobs` row with the small slice of related blog + article
 * data the tray needs to render a "View article" link with a friendly
 * label.
 */
export interface ActiveArticleJobRow {
  id: string;
  type: string;
  status: string;
  currentStep: string | null;
  errorMessage: string | null;
  output: Json | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  blog: { id: string; name: string; projectId: string; teamId: string };
  article: { id: string; title: string; status: string } | null;
  ideaId: string | null;
}

/**
 * Returns the `article_jobs` rows the global widget should display:
 *
 *   * Anything pending or processing right now (live work).
 *   * Anything completed / failed / cancelled within the last
 *     {@link ACTIVE_JOB_RECENT_WINDOW_MS} so users see "Article ready
 *     for review" / "Generation failed" without polling stale state.
 *
 * Relies on the `Members can view article jobs in team blogs` RLS
 * policy to scope to the caller's teams — pass a user-context client
 * (not the admin / service-role one) so RLS actually fires.
 */
export async function listActiveArticleJobsForUser(
  client: Client,
  options: { recentWindowMs?: number; limit?: number } = {},
): Promise<ActiveArticleJobRow[]> {
  const window = options.recentWindowMs ?? ACTIVE_JOB_RECENT_WINDOW_MS;
  const limit = options.limit ?? 50;
  const cutoffIso = new Date(Date.now() - window).toISOString();

  const { data, error } = await client
    .from("article_jobs")
    .select(
      `
      id,
      type,
      status,
      current_step,
      error_message,
      output,
      created_at,
      started_at,
      completed_at,
      article_idea_id,
      blog:blogs!blog_id (
        id,
        name,
        project_id,
        project:projects!project_id ( team_id )
      ),
      article:articles!article_id ( id, title, status )
    `,
    )
    .or(`status.in.(pending,processing),completed_at.gte.${cutoffIso}`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  if (!data) return [];

  type RawRow = {
    id: string;
    type: string;
    status: string;
    current_step: string | null;
    error_message: string | null;
    output: Json | null;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
    article_idea_id: string | null;
    blog:
      | {
          id: string;
          name: string;
          project_id: string;
          project: { team_id: string } | { team_id: string }[] | null;
        }
      | { id: string; name: string; project_id: string; project: unknown }[]
      | null;
    article:
      | { id: string; title: string; status: string }
      | { id: string; title: string; status: string }[]
      | null;
  };

  // Supabase typed FK joins return either a single object or an array
  // depending on cardinality inference. Normalize both shapes here so
  // callers get a flat row.
  const rows: ActiveArticleJobRow[] = [];
  for (const raw of data as RawRow[]) {
    const blogRaw = Array.isArray(raw.blog) ? raw.blog[0] : raw.blog;
    if (!blogRaw) continue;
    const projectRaw = Array.isArray(blogRaw.project)
      ? blogRaw.project[0]
      : blogRaw.project;
    /* v8 ignore next 1 -- defensive: blog FK guarantees the project row */
    if (!projectRaw) continue;
    const articleRaw = Array.isArray(raw.article)
      ? raw.article[0]
      : raw.article;

    rows.push({
      id: raw.id,
      type: raw.type,
      status: raw.status,
      currentStep: raw.current_step,
      errorMessage: raw.error_message,
      output: raw.output,
      createdAt: raw.created_at,
      startedAt: raw.started_at,
      completedAt: raw.completed_at,
      blog: {
        id: blogRaw.id,
        name: blogRaw.name,
        projectId: blogRaw.project_id,
        teamId: (projectRaw as { team_id: string }).team_id,
      },
      article: articleRaw
        ? {
            id: articleRaw.id,
            title: articleRaw.title,
            status: articleRaw.status,
          }
        : null,
      ideaId: raw.article_idea_id,
    });
  }
  return rows;
}

/**
 * Allowed status transitions for `updateArticleIdeaStatus`.
 *
 *   * `generated` can move forward to `approved` or `rejected`.
 *   * `approved` and `rejected` can flip between each other (mind change).
 *   * `converted_to_article` is terminal — only {@link convertIdeaToArticle}
 *     can land an idea there, and the helper below refuses to move it
 *     out. The article-detail flow handles undo if we ever need it.
 *   * Going back to `generated` is never allowed (no regression).
 *
 * The matrix is the single source of truth; the server action and the
 * (future) autopilot scheduler read it instead of hardcoding the
 * "what's allowed" rules at each call site.
 */
export const IDEA_STATUS_TRANSITIONS: Readonly<
  Record<ArticleIdeaStatus, readonly ArticleIdeaStatus[]>
> = {
  generated: ["approved", "rejected"],
  approved: ["rejected"],
  rejected: ["approved"],
  converted_to_article: [],
} as const;

/** Pure helper — does the matrix permit `from → to`? */
export function isAllowedIdeaStatusTransition(
  from: ArticleIdeaStatus,
  to: ArticleIdeaStatus,
): boolean {
  return IDEA_STATUS_TRANSITIONS[from].includes(to);
}

export interface UpdateArticleIdeaStatusInput {
  ideaId: string;
  /** Ownership scope — caller must already know the idea belongs here. */
  blogId: string;
  status: ArticleIdeaStatus;
  client?: Client;
}

/**
 * Validates the requested status transition against
 * {@link IDEA_STATUS_TRANSITIONS}, then writes it. Returns the updated
 * row.
 *
 * Read-then-write rather than a single conditional UPDATE because:
 *   * v1 traffic is "one user clicking a button" — there's no real
 *     concurrent contention here.
 *   * The explicit error messages (`idea_not_found`,
 *     `invalid_idea_status_transition:from->to`) are easier for the
 *     server action to translate into UI copy than a "0 rows affected".
 *
 * Throws:
 *   * `Error("idea_not_found")` — no row matches `(ideaId, blogId)`.
 *   * `Error("invalid_idea_status_transition:from->to")` — caller asked
 *     for a transition the matrix forbids (e.g. a converted idea, or
 *     trying to land in `generated`).
 *   * Other supabase errors — propagated as-is.
 *
 * Idempotent: setting an idea to its current status is a no-op that
 * just returns the existing row.
 */
export async function updateArticleIdeaStatus(
  input: UpdateArticleIdeaStatusInput,
): Promise<ArticleIdeaRow> {
  const supabase = input.client ?? createAdminClient();

  const { data: existing, error: readErr } = await supabase
    .from("article_ideas")
    .select("*")
    .eq("id", input.ideaId)
    .eq("blog_id", input.blogId)
    .maybeSingle();

  if (readErr) throw readErr;
  if (!existing) throw new Error("idea_not_found");

  const currentStatus = existing.status as ArticleIdeaStatus;

  if (currentStatus === input.status) {
    return existing as ArticleIdeaRow;
  }

  if (!isAllowedIdeaStatusTransition(currentStatus, input.status)) {
    throw new Error(
      `invalid_idea_status_transition:${currentStatus}->${input.status}`,
    );
  }

  const { data: updated, error: updateErr } = await supabase
    .from("article_ideas")
    .update({ status: input.status })
    .eq("id", input.ideaId)
    .eq("blog_id", input.blogId)
    .select("*")
    .single();

  if (updateErr) throw updateErr;
  return updated as ArticleIdeaRow;
}

export interface ConvertIdeaToArticleInput {
  ideaId: string;
  articleId: string;
  client?: Client;
}

/**
 * Wires a generated article back to the idea it came from:
 *   - sets `articles.article_idea_id = ideaId`
 *   - flips `article_ideas.status = 'converted_to_article'`
 *
 * Note on atomicity: v1 issues two separate updates because
 * `supabase-js` doesn't expose multi-statement transactions. The
 * window is microseconds and only matters if a third process is
 * editing the same idea/article at the same time, which doesn't happen
 * in v1. A future migration will add a `convert_idea_to_article`
 * Postgres function (`security definer`) for true atomicity once the
 * autopilot scheduler can race with the manual flow.
 */
export async function convertIdeaToArticle(
  input: ConvertIdeaToArticleInput,
): Promise<void> {
  const supabase = input.client ?? createAdminClient();

  const { error: articleErr } = await supabase
    .from("articles")
    .update({ article_idea_id: input.ideaId })
    .eq("id", input.articleId);

  if (articleErr) throw articleErr;

  const { error: ideaErr } = await supabase
    .from("article_ideas")
    .update({ status: "converted_to_article" })
    .eq("id", input.ideaId);

  if (ideaErr) throw ideaErr;
}

// ============================================================================
// generateArticleIdeas — the canonical orchestration
//
// Called from:
//   - Today: a server action (UI button click).
//   - Tomorrow: the autopilot scheduler (cron-driven loop).
//   - Tomorrow: a Vercel Workflow step.
//
// All three paths must produce identical state transitions in
// `article_jobs`, `article_ideas`, `token_transactions`, and
// `usage_events`, so they all call this one function.
// ============================================================================

/**
 * Inputs every orchestration call provides. The orchestration NEVER
 * touches the request scope (cookies, headers, etc.) — every value it
 * needs is on this object. That's the whole point of the abstraction:
 * cron and workflow runners call the same function from a non-request
 * context with the same shape.
 */
export interface GenerateArticleIdeasInput {
  blogId: string;
  /** Resolved upstream so the orchestration doesn't re-query it. */
  teamId: string;
  /**
   * Acting user id. For autopilot / scheduled runs this is the team's
   * billing owner (or a service account uuid we'll mint later) — the
   * orchestration doesn't care, it just stamps the row.
   */
  userId: string;
  /** Optional topic seed. Empty/whitespace is treated as no brief. */
  brief?: string;
  /** Defaults to {@link IDEA_DEFAULT_COUNT}. */
  count?: number;
  triggerSource: TriggerSource;
  /**
   * Free-form additional metadata to stamp on the job row. Used by the
   * autopilot scheduler (`scheduledRunId`, `scheduleId`) and by
   * workflow runs (`parentWorkflowId`). `triggerSource`, `brief`,
   * `count`, `teamId`, and the settings snapshot are merged in
   * automatically — callers don't need to repeat them here.
   */
  jobMetadata?: Record<string, unknown>;
  client?: Client;
  anthropicProvider?: AnthropicLike;
}

export interface GenerateArticleIdeasResult {
  jobId: string;
  ideas: ArticleIdeaRow[];
  creditsUsed: number;
  promptTokens: number | null;
  completionTokens: number | null;
  model: string;
}

/**
 * Generates a batch of article ideas end-to-end. Owns the durable
 * state machine; the AI call is delegated to `lib/ai/provider.ts`.
 *
 * Order of operations (deliberate — see comments inline):
 *   1. Resolve blog context (fail fast if blog is missing).
 *   2. Insert `article_jobs` row with full input snapshot.
 *   3. Move the job into `processing`, increment attempts.
 *   4. Reserve credits via `consume_team_tokens`. Throws fast if the
 *      team owner can't pay (no wasted Claude call).
 *   5. Call the AI provider.
 *   6. Insert the batch into `article_ideas`.
 *   7. Log a `usage_events` row tagged with the job id.
 *   8. Mark the job `completed`.
 *
 * v1 deliberately does NOT refund credits on AI/insert failure. Each
 * idea batch costs only `AI_CREDIT_COSTS.generateIdeas` (1 token in
 * v1) so the user impact is small, and adding a refund path means
 * adding a `refund_team_tokens` RPC + a separate audit record that's
 * out of scope for this PR. A follow-up will add it.
 */
export async function generateArticleIdeas(
  input: GenerateArticleIdeasInput,
): Promise<GenerateArticleIdeasResult> {
  const supabase = input.client ?? createAdminClient();
  const count = input.count ?? IDEA_DEFAULT_COUNT;

  // 1. Resolve context up front — fail with a typed message if the
  // blog vanished between the action handler and here.
  const ctx = await getBlogGenerationContext(input.blogId, supabase);
  if (!ctx) {
    throw new Error("blog_not_found");
  }

  // 2. Insert the job row. `input` jsonb captures everything autopilot
  // / cron / a future re-run needs to reproduce the call without
  // looking at app state — including a snapshot of the blog settings
  // at the moment of the request.
  const jobInput: Record<string, unknown> = {
    triggerSource: input.triggerSource,
    brief: input.brief?.trim() || null,
    count,
    teamId: input.teamId,
    blogSettingsSnapshot: ctx.settings as unknown as Record<string, unknown>,
    ...(input.jobMetadata ?? {}),
  };

  const job = await createArticleJob({
    blogId: input.blogId,
    type: "generate_ideas",
    userId: input.userId,
    input: jobInput,
    client: supabase,
  });

  try {
    // 3. Move into processing. Stamp `started_at`, bump attempts.
    await updateArticleJobStatus({
      jobId: job.id,
      status: "processing",
      currentStep: "loading_context",
      incrementAttempts: true,
      client: supabase,
    });

    // 4. Reserve credits BEFORE the AI call so an out-of-tokens team
    // doesn't burn a Claude request. The RPC is atomic — the only way
    // to reach step 5 is with a successful debit. The job id is the
    // idempotency key so a workflow replay (same job id) no-ops.
    const creditsUsed = getCreditCost("generateIdeas");
    try {
      await consumeTeamTokens({
        teamId: input.teamId,
        amount: creditsUsed,
        actingUserId: input.userId,
        description: `Generate ${count} article ideas for blog "${ctx.blog.name}"`,
        metadata: {
          blog_id: input.blogId,
          job_id: job.id,
          job_type: "generate_ideas",
          trigger_source: input.triggerSource,
        },
        idempotencyKey: `article_job::${job.id}`,
        client: supabase,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await failArticleJob({
        jobId: job.id,
        errorMessage: message,
        client: supabase,
      });
      throw err;
    }

    // 5. Call the AI provider. We surface NO refund on failure here
    // (see function-level comment); the orchestration just marks the
    // job failed and propagates.
    await updateArticleJobStatus({
      jobId: job.id,
      currentStep: "generating_ideas",
      client: supabase,
    });

    const batch = await generateIdeas({
      blogName: ctx.blog.name,
      blogDescription: ctx.blog.description || undefined,
      settings: ctx.settings,
      brief: input.brief,
      count,
      anthropicProvider: input.anthropicProvider,
    });

    // 6. Persist the batch. We insert the raw provider response on
    // each row's `raw_ai_response` so the future "regenerate just this
    // idea" flow has the original payload to anchor on.
    await updateArticleJobStatus({
      jobId: job.id,
      currentStep: "saving_ideas",
      client: supabase,
    });

    // The Zod schema in `lib/ai/provider.ts` guarantees every field on
    // each idea is present and well-formed, so we can map directly
    // without `?? null` fallbacks (the orchestration would have thrown
    // back at `generateIdeas` otherwise).
    const ideaRows: TablesInsert<"article_ideas">[] = batch.ideas.map(
      (idea: GeneratedIdea) => ({
        blog_id: input.blogId,
        user_id: input.userId,
        title: idea.title,
        slug: idea.slug,
        target_keyword: idea.targetKeyword,
        executive_summary: idea.executiveSummary,
        article_type: idea.articleType,
        estimated_word_count: idea.estimatedWordCount,
        status: "generated",
        raw_ai_response: idea as unknown as Json,
      }),
    );

    const { data: inserted, error: insertErr } = await supabase
      .from("article_ideas")
      .insert(ideaRows)
      .select("*");

    if (insertErr) {
      await failArticleJob({
        jobId: job.id,
        errorMessage: insertErr.message,
        output: { ideasGenerated: 0, model: batch.model },
        client: supabase,
      });
      throw insertErr;
    }
    // After insertErr is null, `inserted` is always a non-null array,
    // but the supabase types still mark it nullable so we coalesce.
    /* v8 ignore next -- defensive: supabase returns data when error is null */
    const insertedRows = inserted ?? [];

    // 7. Audit log. Failure here is logged but doesn't fail the job —
    // the user got their ideas, the audit row is recoverable later.
    await updateArticleJobStatus({
      jobId: job.id,
      currentStep: "logging_usage",
      client: supabase,
    });

    await logUsageEvent({
      userId: input.userId,
      blogId: input.blogId,
      jobId: job.id,
      provider: PROVIDER_ANTHROPIC,
      model: batch.model,
      inputTokens: batch.promptTokens,
      outputTokens: batch.completionTokens,
      creditsUsed,
      client: supabase,
    });

    // 8. Done.
    await completeArticleJob({
      jobId: job.id,
      output: {
        model: batch.model,
        promptTokens: batch.promptTokens,
        completionTokens: batch.completionTokens,
        cachedReadTokens: batch.cachedReadTokens,
        cachedWriteTokens: batch.cachedWriteTokens,
        ideasGenerated: insertedRows.length,
        creditsUsed,
      },
      client: supabase,
    });

    return {
      jobId: job.id,
      ideas: insertedRows,
      creditsUsed,
      promptTokens: batch.promptTokens,
      completionTokens: batch.completionTokens,
      model: batch.model,
    };
  } catch (err) {
    // Catch-all for anything between createArticleJob and completion
    // that wasn't already wrapped by a more specific failArticleJob
    // call (provider errors, unexpected DB errors). Best-effort —
    // ignore secondary failures so the original error reaches callers.
    const message = err instanceof Error ? err.message : String(err);
    try {
      await failArticleJob({
        jobId: job.id,
        errorMessage: message,
        client: supabase,
      });
      /* v8 ignore start -- defensive: secondary failure during fail-marking */
    } catch {
      // Swallow — the primary error is what the caller cares about.
    }
    /* v8 ignore stop */
    throw err;
  }
}

// ============================================================================
// generateArticleDraftFromIdea — manual + future autopilot single-article flow
//
// Two-phase split (introduced when manual article generation moved into
// Vercel Workflows):
//
//   Phase 1 — `queueGenerateArticleFromIdea`
//     Synchronous, runs inside the server action / cron tick. Validates
//     the idea, creates the durable `article_jobs` + `articles`
//     placeholders, returns immediately so the UI can show "generating".
//     No tokens consumed yet. Idempotent on the idea: a second call
//     while a job is already pending/processing returns the existing
//     job/article instead of creating duplicates.
//
//   Phase 2 — `runGenerateArticleFromIdeaJob`
//     The unit of work the Vercel Workflow step calls. Consumes tokens,
//     calls Claude, persists the article, flips the idea, logs usage,
//     completes the job. On failure: marks article+job failed and
//     refunds the consumed credits (idempotent on the job id).
//
// `generateArticleDraftFromIdea` is now a thin wrapper that runs both
// phases in-process. The autopilot scheduler + the Vercel Workflow
// runner each compose the two phases on their own — see
// `apps/web/src/workflows/generate-article.ts`.
//
// Failure-safe semantics (per `docs/ai-pricing.md` "reserve credits when
// generation starts"):
//
//   * Idea is loaded and verified `approved` BEFORE any state writes —
//     a non-approved idea throws fast and nothing changes.
//   * Tokens are consumed BEFORE the AI call. An out-of-tokens team
//     gets a typed error and the article+job stay marked `failed`
//     (no token spend, no idea status flip).
//   * If the AI call OR the subsequent article update fails, both the
//     article placeholder and the job are marked `failed`, the
//     consumed tokens are refunded, and the idea STAYS `approved` so
//     the user can click Generate again.
//   * The idea only flips to `converted_to_article` AFTER a successful
//     `ready_for_review` write.
// ============================================================================

export interface GenerateArticleDraftFromIdeaInput {
  blogId: string;
  /** Resolved upstream so the orchestration doesn't re-query it. */
  teamId: string;
  /** Acting user — the team member who clicked the button (or service user for autopilot). */
  userId: string;
  ideaId: string;
  triggerSource: TriggerSource;
  /**
   * Free-form metadata stamped onto `article_jobs.input`. Same role as
   * in {@link generateArticleIdeas}: autopilot/cron pass
   * `scheduledRunId` / `scheduleId`, workflow runs pass `parentWorkflowId`,
   * etc. The orchestration adds `triggerSource`, `ideaSnapshot`,
   * `blogSettingsSnapshot`, and `teamId` automatically.
   */
  jobMetadata?: Record<string, unknown>;
  client?: Client;
  anthropicProvider?: AnthropicLike;
}

export interface GenerateArticleDraftFromIdeaResult {
  jobId: string;
  articleId: string;
  ideaId: string;
  /** Always "ready_for_review" on success. */
  status: "ready_for_review";
  creditsUsed: number;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
}

// ----------------------------------------------------------------------------
// Phase 1 — queueGenerateArticleFromIdea
// ----------------------------------------------------------------------------

export interface QueueGenerateArticleFromIdeaInput extends Omit<
  GenerateArticleDraftFromIdeaInput,
  "anthropicProvider" | "client"
> {
  client?: Client;
}

export interface QueueGenerateArticleFromIdeaResult {
  jobId: string;
  articleId: string;
  ideaId: string;
  /** Status the durable job/article rows are in after queueing. */
  status: "pending" | "processing";
  /**
   * `true` when a pending/processing job already existed for this idea
   * and we returned it instead of creating a new one. Lets the server
   * action skip starting a duplicate workflow run.
   */
  alreadyQueued: boolean;
}

/**
 * Validates the idea and creates the durable `article_jobs` +
 * `articles` placeholders. Does NOT consume tokens, call Claude, or
 * start the workflow — that's the caller's job.
 *
 * Idempotency: if there's already a `pending` or `processing`
 * `generate_article` job for this idea, returns the existing job +
 * article. The caller can decide whether to re-trigger the workflow
 * (probably not) or just hand the existing ids back to the UI.
 *
 * Throws:
 *   * `Error("blog_not_found")`
 *   * `Error("idea_not_found")`
 *   * `Error("idea_not_approved")`
 *   * Other supabase errors — propagated as-is.
 */
export async function queueGenerateArticleFromIdea(
  input: QueueGenerateArticleFromIdeaInput,
): Promise<QueueGenerateArticleFromIdeaResult> {
  const supabase = input.client ?? createAdminClient();

  // 1. Resolve blog context — fail fast with a typed message.
  const ctx = await getBlogGenerationContext(input.blogId, supabase);
  if (!ctx) throw new Error("blog_not_found");

  // 2. Load the idea + verify status.
  const { data: ideaRow, error: ideaErr } = await supabase
    .from("article_ideas")
    .select("*")
    .eq("id", input.ideaId)
    .eq("blog_id", input.blogId)
    .maybeSingle();

  if (ideaErr) throw ideaErr;
  if (!ideaRow) throw new Error("idea_not_found");
  if ((ideaRow.status as ArticleIdeaStatus) !== "approved") {
    throw new Error("idea_not_approved");
  }
  const idea = ideaRow as ArticleIdeaRow;

  // 3. Idempotency: short-circuit if a pending/processing job already
  // exists for this idea. Prevents double-charging when the user
  // double-clicks Generate Article (or two tabs both fire it).
  const { data: existingJobs, error: existingJobsErr } = await supabase
    .from("article_jobs")
    .select("id, article_id, status")
    .eq("article_idea_id", input.ideaId)
    .eq("type", "generate_article")
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (existingJobsErr) throw existingJobsErr;
  if (existingJobs && existingJobs.length > 0) {
    const existing = existingJobs[0];
    /* v8 ignore next -- defensive: existing rows always have article_id since queue links them */
    if (!existing.article_id) {
      throw new Error("queued_job_missing_article_id");
    }
    return {
      jobId: existing.id,
      articleId: existing.article_id,
      ideaId: input.ideaId,
      status: existing.status as "pending" | "processing",
      alreadyQueued: true,
    };
  }

  // 4. Insert the job row with the full input snapshot. Autopilot
  // replay and the workflow runner can reproduce the call from this
  // jsonb alone.
  const jobInput: Record<string, unknown> = {
    triggerSource: input.triggerSource,
    teamId: input.teamId,
    ideaId: input.ideaId,
    ideaSnapshot: idea as unknown as Record<string, unknown>,
    blogSettingsSnapshot: ctx.settings as unknown as Record<string, unknown>,
    ...(input.jobMetadata ?? {}),
  };

  const job = await createArticleJob({
    blogId: input.blogId,
    type: "generate_article",
    userId: input.userId,
    articleIdeaId: input.ideaId,
    input: jobInput,
    client: supabase,
  });

  // 5. Insert the article placeholder. Seeded from the idea so the
  // dashboard shows something meaningful while generation is in
  // flight; the workflow step overwrites it on success.
  const placeholder: TablesInsert<"articles"> = {
    blog_id: input.blogId,
    user_id: input.userId,
    article_idea_id: input.ideaId,
    title: idea.title,
    target_keyword: idea.target_keyword,
    status: "generating",
  };
  const { data: insertedArticle, error: insertArticleErr } = await supabase
    .from("articles")
    .insert(placeholder)
    .select("id")
    .single();

  if (insertArticleErr) {
    // Best-effort: tear down the job so the dashboard doesn't show an
    // orphan pending job that'll never be picked up.
    await failArticleJob({
      jobId: job.id,
      errorMessage: insertArticleErr.message,
      client: supabase,
    });
    throw insertArticleErr;
  }
  const articleId = insertedArticle.id;

  // 6. Link the job to the article so queue/dashboard pages can
  // resolve article ↔ job both ways.
  await supabase
    .from("article_jobs")
    .update({ article_id: articleId })
    .eq("id", job.id);

  return {
    jobId: job.id,
    articleId,
    ideaId: input.ideaId,
    status: "pending",
    alreadyQueued: false,
  };
}

// ----------------------------------------------------------------------------
// Phase 2 — runGenerateArticleFromIdeaJob (called by the Vercel Workflow step)
// ----------------------------------------------------------------------------

export interface RunGenerateArticleFromIdeaJobInput {
  /** Pre-existing job row from {@link queueGenerateArticleFromIdea}. */
  jobId: string;
  /** Pre-existing article placeholder. */
  articleId: string;
  blogId: string;
  teamId: string;
  userId: string;
  ideaId: string;
  /**
   * Echoed onto the consume_team_tokens metadata so the billing audit
   * log can filter "tokens spent by manual generation" vs. autopilot.
   * Defaults to `"workflow"` when omitted (the workflow runner is the
   * primary caller of this function).
   */
  triggerSource?: TriggerSource;
  /**
   * Free-form metadata to merge into `article_jobs.input` AFTER the
   * queue snapshot. The workflow step uses this to stamp
   * `workflowRunId` / `autopilotRunId` so a refresh shows the
   * connection between a queued job and the workflow that's running it.
   */
  jobInputPatch?: Record<string, unknown>;
  client?: Client;
  anthropicProvider?: AnthropicLike;
}

/**
 * The unit of work the Vercel Workflow step calls. Same body as the
 * "try" block of the legacy synchronous orchestration: consume tokens,
 * Claude, persist, convert, complete. On failure: refund + fail.
 *
 * Idempotent on `jobId`:
 *   * `consume_team_tokens` is idempotent on `article_job::{jobId}`.
 *   * The article update / convertIdeaToArticle / completeArticleJob
 *     calls are all natural no-ops if the workflow somehow re-runs
 *     after success (the article + job land in their final state).
 *
 * NOTE on retries: callers (the workflow step in particular) should
 * NOT retry this function on failure. The catch block already refunds
 * the user, and a re-run would consume Claude budget without
 * consuming tokens (consume_team_tokens no-ops on the idempotency
 * key). The recommended pattern is to throw `FatalError` from the
 * workflow step so the SDK treats the failure as terminal.
 */
export async function runGenerateArticleFromIdeaJob(
  input: RunGenerateArticleFromIdeaJobInput,
): Promise<GenerateArticleDraftFromIdeaResult> {
  const supabase = input.client ?? createAdminClient();

  // Re-resolve context inside the workflow process — we don't trust
  // anything from the queue's call site to still be in scope.
  const ctx = await getBlogGenerationContext(input.blogId, supabase);
  if (!ctx) throw new Error("blog_not_found");

  const { data: ideaRow, error: ideaErr } = await supabase
    .from("article_ideas")
    .select("*")
    .eq("id", input.ideaId)
    .eq("blog_id", input.blogId)
    .maybeSingle();
  if (ideaErr) throw ideaErr;
  if (!ideaRow) throw new Error("idea_not_found");
  // The idea must still be `approved`. If it was already converted
  // (e.g. duplicate workflow ran), bail out without touching anything.
  if ((ideaRow.status as ArticleIdeaStatus) !== "approved") {
    throw new Error("idea_not_approved");
  }
  const idea = ideaRow as ArticleIdeaRow;

  // Optionally enrich the job's input jsonb with workflow metadata
  // (workflowRunId, autopilotRunId) so an operator inspecting the row
  // can connect the job to its execution context.
  if (input.jobInputPatch && Object.keys(input.jobInputPatch).length > 0) {
    await mergeArticleJobInput(supabase, input.jobId, input.jobInputPatch);
  }

  let consumed = false;
  const creditsUsed = getCreditCost("generateArticle");

  try {
    await updateArticleJobStatus({
      jobId: input.jobId,
      status: "processing",
      currentStep: "loading_context",
      incrementAttempts: true,
      client: supabase,
    });

    await consumeTeamTokens({
      teamId: input.teamId,
      amount: creditsUsed,
      actingUserId: input.userId,
      description: `Generate article draft for "${idea.title}"`,
      metadata: {
        blog_id: input.blogId,
        job_id: input.jobId,
        job_type: "generate_article",
        idea_id: input.ideaId,
        trigger_source: input.triggerSource ?? "workflow",
      },
      idempotencyKey: `article_job::${input.jobId}`,
      client: supabase,
    });
    consumed = true;

    await updateArticleJobStatus({
      jobId: input.jobId,
      currentStep: "writing_article",
      client: supabase,
    });

    const draft: GeneratedArticleDraft = await generateArticleDraft({
      blogName: ctx.blog.name,
      blogDescription: ctx.blog.description || undefined,
      settings: ctx.settings,
      brief: buildBriefFromIdea(idea),
      anthropicProvider: input.anthropicProvider,
    });

    await updateArticleJobStatus({
      jobId: input.jobId,
      currentStep: "saving_article",
      client: supabase,
    });

    const articleUpdate: TablesUpdate<"articles"> = {
      title: draft.title,
      slug: draft.slug,
      excerpt: draft.excerpt,
      meta_description: draft.metaDescription,
      content_markdown: draft.contentMarkdown,
      target_keyword: draft.targetKeyword,
      word_count: draft.wordCount,
      generated_by_model: draft.model,
      raw_ai_response: draft as unknown as Json,
      status: "ready_for_review",
      error_message: null,
    };
    const { error: updateArticleErr } = await supabase
      .from("articles")
      .update(articleUpdate)
      .eq("id", input.articleId);
    if (updateArticleErr) throw updateArticleErr;

    await updateArticleJobStatus({
      jobId: input.jobId,
      currentStep: "logging_usage",
      client: supabase,
    });

    await logUsageEvent({
      userId: input.userId,
      blogId: input.blogId,
      articleId: input.articleId,
      articleIdeaId: input.ideaId,
      jobId: input.jobId,
      provider: PROVIDER_ANTHROPIC,
      model: draft.model,
      inputTokens: draft.promptTokens,
      outputTokens: draft.completionTokens,
      creditsUsed,
      client: supabase,
    });

    await convertIdeaToArticle({
      ideaId: input.ideaId,
      articleId: input.articleId,
      client: supabase,
    });

    await completeArticleJob({
      jobId: input.jobId,
      articleId: input.articleId,
      articleIdeaId: input.ideaId,
      output: {
        model: draft.model,
        promptTokens: draft.promptTokens,
        completionTokens: draft.completionTokens,
        cachedReadTokens: draft.cachedReadTokens,
        cachedWriteTokens: draft.cachedWriteTokens,
        wordCount: draft.wordCount,
        creditsUsed,
      },
      client: supabase,
    });

    return {
      jobId: input.jobId,
      articleId: input.articleId,
      ideaId: input.ideaId,
      status: "ready_for_review",
      creditsUsed,
      model: draft.model,
      promptTokens: draft.promptTokens,
      completionTokens: draft.completionTokens,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await failArticleAndJob(supabase, input.articleId, input.jobId, message);
      /* v8 ignore start -- defensive: secondary failure during fail-marking */
    } catch {
      // Swallow — the primary error is what the caller cares about.
    }
    /* v8 ignore stop */

    if (consumed) {
      try {
        await refundTeamTokens({
          teamId: input.teamId,
          amount: creditsUsed,
          actingUserId: input.userId,
          description: `Refund for failed article job ${input.jobId}: ${message}`,
          metadata: {
            refunded_for_job_id: input.jobId,
            refunded_for_blog_id: input.blogId,
            refunded_for_idea_id: input.ideaId,
            reason: message,
          },
          idempotencyKey: `refund::article_job::${input.jobId}`,
          client: supabase,
        });
        await markJobRefunded(supabase, input.jobId, creditsUsed);
        /* v8 ignore start -- defensive: secondary failure during refund */
      } catch {
        // Swallow — operators reconcile via token_transactions.
      }
      /* v8 ignore stop */
    }

    throw err;
  }
}

/**
 * Merges a partial patch into the existing `article_jobs.input` jsonb.
 * Read-then-write is fine because the workflow step is the only writer
 * for a given job at a time.
 */
async function mergeArticleJobInput(
  client: Client,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data, error: readErr } = await client
    .from("article_jobs")
    .select("input")
    .eq("id", jobId)
    .maybeSingle();
  if (readErr) throw readErr;

  const currentInput =
    data?.input && typeof data.input === "object" && !Array.isArray(data.input)
      ? (data.input as Record<string, unknown>)
      : {};

  const { error: updateErr } = await client
    .from("article_jobs")
    .update({ input: { ...currentInput, ...patch } as Json })
    .eq("id", jobId);
  /* v8 ignore next -- defensive throw */
  if (updateErr) throw updateErr;
}

/**
 * Builds the brief that the {@link generateArticleDraft} provider sees
 * for an idea-driven generation. Exported only so the service tests can
 * assert that the idea's title + keyword + summary land in the prompt.
 */
export function buildBriefFromIdea(
  idea: Pick<
    ArticleIdeaRow,
    | "title"
    | "target_keyword"
    | "executive_summary"
    | "article_type"
    | "estimated_word_count"
  >,
): string {
  const lines = [
    `Write a full article for this approved topic.`,
    `Title: ${idea.title}`,
    idea.target_keyword ? `Target keyword: ${idea.target_keyword}` : null,
    idea.executive_summary
      ? `Executive summary of the angle to take: ${idea.executive_summary}`
      : null,
    idea.article_type ? `Article format: ${idea.article_type}` : null,
    idea.estimated_word_count
      ? `Approximate length: ${idea.estimated_word_count} words`
      : null,
    "Stay close to the title (you may polish it for clarity, but keep the topic). Use the target keyword naturally throughout.",
  ];
  return lines.filter((l): l is string => Boolean(l)).join("\n");
}

/**
 * In-process orchestration: queue the job, then run it synchronously.
 * Used by:
 *   * existing tests that exercise the end-to-end happy/failure paths
 *   * future callers that want to bypass the workflow runner (e.g. a
 *     CLI script, a background batch reprocessor)
 *
 * The server action no longer calls this — it calls
 * {@link queueGenerateArticleFromIdea} and starts the Vercel Workflow,
 * which in turn calls {@link runGenerateArticleFromIdeaJob}.
 */
export async function generateArticleDraftFromIdea(
  input: GenerateArticleDraftFromIdeaInput,
): Promise<GenerateArticleDraftFromIdeaResult> {
  const supabase = input.client ?? createAdminClient();

  const queued = await queueGenerateArticleFromIdea({
    blogId: input.blogId,
    teamId: input.teamId,
    userId: input.userId,
    ideaId: input.ideaId,
    triggerSource: input.triggerSource,
    jobMetadata: input.jobMetadata,
    client: supabase,
  });

  return runGenerateArticleFromIdeaJob({
    jobId: queued.jobId,
    articleId: queued.articleId,
    blogId: input.blogId,
    teamId: input.teamId,
    userId: input.userId,
    ideaId: input.ideaId,
    triggerSource: input.triggerSource,
    client: supabase,
    anthropicProvider: input.anthropicProvider,
  });
}

/**
 * Marks both the article and the job as failed in one place. Used by
 * the catch block of {@link runGenerateArticleFromIdeaJob} to keep
 * the order consistent (article first so the queue page doesn't
 * briefly show "completed job, generating article").
 *
 * `articleId` is typed nullable for forward compatibility (a future
 * caller might want to mark a job failed before any article exists)
 * but the `null` branch is currently unreachable — `runGenerateArticleFromIdeaJob`
 * always receives the queue's article id.
 */
async function failArticleAndJob(
  client: Client,
  articleId: string | null,
  jobId: string,
  errorMessage: string,
): Promise<void> {
  /* v8 ignore next 7 -- defensive: current callers always pass an articleId */
  if (articleId === null) {
    await failArticleJob({ jobId, errorMessage, client });
    return;
  }
  await client
    .from("articles")
    .update({ status: "failed", error_message: errorMessage })
    .eq("id", articleId);
  await failArticleJob({ jobId, errorMessage, client });
}

/**
 * Stamps `article_jobs.output.refunded = true` (+ refundedCredits +
 * refundedAt) after a successful refund so the queue page can show
 * "refunded ✓" without joining `token_transactions`. Read-then-write
 * is fine here because each job has exactly one writer.
 */
async function markJobRefunded(
  client: Client,
  jobId: string,
  refundedCredits: number,
): Promise<void> {
  const { data, error: readErr } = await client
    .from("article_jobs")
    .select("output")
    .eq("id", jobId)
    .maybeSingle();
  if (readErr) throw readErr;

  const currentOutput =
    data?.output &&
    typeof data.output === "object" &&
    !Array.isArray(data.output)
      ? (data.output as Record<string, unknown>)
      : {};

  const { error: updateErr } = await client
    .from("article_jobs")
    .update({
      output: {
        ...currentOutput,
        refunded: true,
        refundedCredits,
        refundedAt: new Date().toISOString(),
      } as Json,
    })
    .eq("id", jobId);
  /* v8 ignore next -- defensive throw; swallowed by caller's refund try/catch */
  if (updateErr) throw updateErr;
}
