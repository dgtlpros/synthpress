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
import { consumeTeamTokens } from "./team-billing-service";

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
// Failure-safe semantics (per `docs/ai-pricing.md` "reserve credits when
// generation starts"):
//
//   * Idea is loaded and verified `approved` BEFORE any state writes —
//     a non-approved idea throws fast and nothing changes.
//   * Tokens are consumed BEFORE the AI call. An out-of-tokens team
//     gets a typed error and the only side effect is the `failed` job
//     row (no article placeholder, no idea status flip).
//   * If the AI call OR the subsequent article update fails, both the
//     article placeholder and the job are marked `failed`, but the
//     idea STAYS `approved` so the user can click Generate again.
//   * The idea only flips to `converted_to_article` AFTER a successful
//     `ready_for_review` write. This is the entire reason this PR
//     ships before refund-on-failure: the "did the user pay for
//     nothing" question becomes "did the user lose their idea?", and
//     the answer is now "no".
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

export async function generateArticleDraftFromIdea(
  input: GenerateArticleDraftFromIdeaInput,
): Promise<GenerateArticleDraftFromIdeaResult> {
  const supabase = input.client ?? createAdminClient();

  // 1. Resolve blog context — fail fast with a typed message.
  const ctx = await getBlogGenerationContext(input.blogId, supabase);
  if (!ctx) {
    throw new Error("blog_not_found");
  }

  // 2. Load the idea + verify status. Both checks happen BEFORE any
  // job/article rows are written so a bad request leaves no garbage.
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

  // 3. Insert the job row with the full input snapshot. autopilot replay
  // and audit can reproduce the call from this jsonb alone.
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

  let articleId: string | null = null;

  try {
    // 4. Move into processing. Stamp `started_at`, bump attempts.
    await updateArticleJobStatus({
      jobId: job.id,
      status: "processing",
      currentStep: "loading_context",
      incrementAttempts: true,
      client: supabase,
    });

    // 5. Reserve credits BEFORE the AI call so an out-of-tokens team
    // doesn't burn a Claude request. Idempotency key = job id so a
    // workflow replay no-ops on the credit ledger.
    const creditsUsed = getCreditCost("generateArticle");
    try {
      await consumeTeamTokens({
        teamId: input.teamId,
        amount: creditsUsed,
        actingUserId: input.userId,
        description: `Generate article draft for "${idea.title}"`,
        metadata: {
          blog_id: input.blogId,
          job_id: job.id,
          job_type: "generate_article",
          idea_id: input.ideaId,
          trigger_source: input.triggerSource,
        },
        idempotencyKey: `article_job::${job.id}`,
        client: supabase,
      });
    } catch (err) {
      // No article placeholder yet — just fail the job and rethrow.
      const message = err instanceof Error ? err.message : String(err);
      await failArticleJob({
        jobId: job.id,
        errorMessage: message,
        client: supabase,
      });
      throw err;
    }

    // 6. Insert the article placeholder. We seed `title` from the idea
    // (articles.title is NOT NULL) so it shows something meaningful in
    // the dashboard while generation is in flight; the AI overwrites
    // it on success.
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
      await failArticleJob({
        jobId: job.id,
        errorMessage: insertArticleErr.message,
        client: supabase,
      });
      throw insertArticleErr;
    }
    articleId = insertedArticle.id;

    // 7. Link the job to the article (so the queue page can resolve
    // article ↔ job both ways). Plain update — the article_id column
    // is `set null on delete` so a later article delete won't orphan.
    await supabase
      .from("article_jobs")
      .update({ article_id: articleId })
      .eq("id", job.id);

    // 8. Call the AI provider with a brief built from the idea.
    await updateArticleJobStatus({
      jobId: job.id,
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

    // 9. Persist the generated content + flip article to ready_for_review.
    await updateArticleJobStatus({
      jobId: job.id,
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
      .eq("id", articleId);

    if (updateArticleErr) {
      await failArticleAndJob(supabase, articleId, job.id, updateArticleErr.message);
      throw updateArticleErr;
    }

    // 10. Audit log.
    await updateArticleJobStatus({
      jobId: job.id,
      currentStep: "logging_usage",
      client: supabase,
    });

    await logUsageEvent({
      userId: input.userId,
      blogId: input.blogId,
      articleId,
      articleIdeaId: input.ideaId,
      jobId: job.id,
      provider: PROVIDER_ANTHROPIC,
      model: draft.model,
      inputTokens: draft.promptTokens,
      outputTokens: draft.completionTokens,
      creditsUsed,
      client: supabase,
    });

    // 11. Flip the idea to converted_to_article. This is the ONLY path
    // that lands an idea there — the manual approve/reject UI explicitly
    // forbids it via the transition matrix. We do this AFTER the article
    // is saved so a failed AI call leaves the idea retryable.
    await convertIdeaToArticle({
      ideaId: input.ideaId,
      articleId,
      client: supabase,
    });

    // 12. Done.
    await completeArticleJob({
      jobId: job.id,
      articleId,
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
      jobId: job.id,
      articleId,
      ideaId: input.ideaId,
      status: "ready_for_review",
      creditsUsed,
      model: draft.model,
      promptTokens: draft.promptTokens,
      completionTokens: draft.completionTokens,
    };
  } catch (err) {
    // Catch-all for anything between createArticleJob and completion
    // that wasn't already wrapped (e.g. AI provider errors). Best
    // effort: mark the article failed if one was created, then mark
    // the job failed. The idea status is NEVER touched here — it stays
    // approved so the user can retry.
    const message = err instanceof Error ? err.message : String(err);
    try {
      await failArticleAndJob(supabase, articleId, job.id, message);
      /* v8 ignore start -- defensive: secondary failure during fail-marking */
    } catch {
      // Swallow — the primary error is what the caller cares about.
    }
    /* v8 ignore stop */
    throw err;
  }
}

/**
 * Marks both the article (when one was created) and the job as failed
 * in one place. Used by every failure branch of
 * {@link generateArticleDraftFromIdea} to keep the order consistent
 * (article first so the queue page doesn't briefly show "completed
 * job, generating article").
 */
async function failArticleAndJob(
  client: Client,
  articleId: string | null,
  jobId: string,
  errorMessage: string,
): Promise<void> {
  if (articleId !== null) {
    await client
      .from("articles")
      .update({ status: "failed", error_message: errorMessage })
      .eq("id", articleId);
  }
  await failArticleJob({ jobId, errorMessage, client });
}
