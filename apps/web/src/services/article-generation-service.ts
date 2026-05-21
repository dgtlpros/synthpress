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
import {
  ACTIVE_JOB_RECENT_WINDOW_MS,
  type ActiveArticleJobRow,
} from "@/lib/active-jobs";
import { getCreditCost } from "@/lib/ai/config";
import {
  type AnthropicLike,
  type GeneratedArticleDraft,
  type GeneratedIdea,
  IDEA_DEFAULT_COUNT,
  generateArticleDraft,
  generateIdeas,
  getArticleGenerationFailureKind,
  SchemaRetryFailedError,
  TruncatedArticleOutputError,
  TruncationRetryFailedError,
} from "@/lib/ai/provider";
import { consumeTeamTokens, refundTeamTokens } from "./team-billing-service";
import {
  pickImagesForArticle,
  type PickImagesForArticleResult,
} from "./article-image-picker-service";
import {
  hasBlogWordPressConnection,
  PublishArticleError,
  publishArticleToWordPressDraft,
} from "./wordpress-publish-service";
import { PUBLISH_ARTICLE_ERROR_COPY } from "@/lib/wordpress-publish-error-copy";
import { syncAutopilotRunWordPressDraftCounters } from "./blog-autopilot-run-service";

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
  "picking_images",
  "logging_usage",
  "sending_to_wordpress",
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
    /** High-level niche/category from `blogs.niche`. */
    niche: string;
    /** Parsed `blogs.keywords` array (may be empty). */
    keywords: string[];
    /** Legacy `blogs.ai_prompt_template` — optional extra prompt guidance. */
    aiPromptTemplate: string;
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
    .select(
      "id, name, description, slug, niche, keywords, ai_prompt_template, project_id, settings",
    )
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
      niche: blog.niche ?? "",
      keywords: blog.keywords ?? [],
      aiPromptTemplate: blog.ai_prompt_template ?? "",
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
 * Reads article ideas for a blog, newest first. Used by the
 * `/blogs/[blogId]/ideas` page (which needs archived rows so the
 * Archived tab can render them) and any future autopilot dedupe step
 * that wants to check existing titles before generating more.
 *
 * `includeArchived` defaults to `true` because the Ideas dashboard
 * does its own tab-level filtering. Other callers (autopilot,
 * dashboards that don't care about archived ideas) can pass `false`
 * to filter at the DB level.
 */
export async function listArticleIdeasForBlog(
  blogId: string,
  client?: Client,
  options: { includeArchived?: boolean } = {},
): Promise<ArticleIdeaRow[]> {
  const supabase = client ?? createAdminClient();
  const includeArchived = options.includeArchived ?? true;

  let query = supabase.from("article_ideas").select("*").eq("blog_id", blogId);

  if (!includeArchived) {
    query = query.is("archived_at", null);
  }

  const { data, error } = await query.order("created_at", {
    ascending: false,
  });

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
 * Re-exported from `lib/active-jobs` so server callers (this service
 * layer + the action) can keep using the same import paths as before.
 * The actual definitions live in `lib/` so client modules (the global
 * tray hook + components) can import them WITHOUT pulling this
 * `server-only` module into the client bundle.
 */
export { ACTIVE_JOB_RECENT_WINDOW_MS };
export type { ActiveArticleJobRow };

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
// Archive / unarchive — soft delete for ideas
//
// Archive is intentionally a separate `archived_at` timestamp column
// (see migration 00025) rather than a new `status` value. That keeps
// the lifecycle state machine clean: an idea archived from
// `converted_to_article` keeps its terminal status so the "View
// article" link still works on the Archived tab, and unarchive is a
// trivial timestamp reset that doesn't need to remember the previous
// state.
//
// Filtering rules consumers should apply:
//   * Active backlog views — `archived_at is null`.
//   * Archived view — `archived_at is not null`.
//   * Autopilot backlog math + idea selection — `archived_at is null`
//     (archived ideas neither count toward the threshold nor become
//     articles).
// ============================================================================

export interface ArchiveArticleIdeaInput {
  ideaId: string;
  /** Ownership scope — caller must already know the idea belongs here. */
  blogId: string;
  client?: Client;
}

/**
 * Marks the idea archived by stamping `archived_at`. Idempotent: if
 * the idea is already archived, the existing timestamp is preserved
 * (we re-stamp to keep "archived recently" sort order honest, but the
 * caller can't distinguish the no-op from a fresh write).
 *
 * Throws:
 *   * `Error("idea_not_found")` — no row matches `(ideaId, blogId)`.
 *   * Other supabase errors — propagated as-is.
 *
 * Status is NOT touched — an archived `approved` idea is still
 * "approved" semantically, just hidden from the backlog. Unarchive
 * restores it to wherever it was on the lifecycle.
 */
export async function archiveArticleIdea(
  input: ArchiveArticleIdeaInput,
): Promise<ArticleIdeaRow> {
  const supabase = input.client ?? createAdminClient();

  const { data, error } = await supabase
    .from("article_ideas")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", input.ideaId)
    .eq("blog_id", input.blogId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("idea_not_found");
  return data as ArticleIdeaRow;
}

export interface UnarchiveArticleIdeaInput {
  ideaId: string;
  blogId: string;
  client?: Client;
}

/**
 * Clears `archived_at`, restoring the idea to its lifecycle position.
 * Idempotent — un-archiving a non-archived idea is a no-op write.
 *
 * Throws:
 *   * `Error("idea_not_found")` — no row matches `(ideaId, blogId)`.
 *   * Other supabase errors — propagated as-is.
 */
export async function unarchiveArticleIdea(
  input: UnarchiveArticleIdeaInput,
): Promise<ArticleIdeaRow> {
  const supabase = input.client ?? createAdminClient();

  const { data, error } = await supabase
    .from("article_ideas")
    .update({ archived_at: null })
    .eq("id", input.ideaId)
    .eq("blog_id", input.blogId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("idea_not_found");
  return data as ArticleIdeaRow;
}

/**
 * Returns the count of ideas that COUNT TOWARD the autopilot backlog
 * threshold for `blogId`:
 *
 *   * `status IN ('generated', 'approved')` — both pending-review and
 *     already-approved ideas are usable (the former gets auto-approved
 *     when `requireReview === false`; the latter is what the scheduler
 *     actually picks for article generation).
 *   * `archived_at IS NULL` — archived ideas are excluded.
 *   * `rejected` and `converted_to_article` are NEVER usable backlog
 *     (rejected = explicitly killed, converted = already published).
 *
 * Used by `runAutopilotForBlog` to compute the top-up deficit:
 *
 *     needed = max(0, backlogThreshold - usableCount)
 *     batch  = min(needed, MAX_AUTOPILOT_IDEAS_PER_RUN)
 *
 * Uses Supabase's `count: "exact", head: true` so no rows are fetched
 * — the query is a pure server-side aggregate.
 */
export async function countUsableIdeasForBacklog(
  blogId: string,
  client?: Client,
): Promise<number> {
  const supabase = client ?? createAdminClient();

  const { count, error } = await supabase
    .from("article_ideas")
    .select("id", { count: "exact", head: true })
    .eq("blog_id", blogId)
    .in("status", [
      "generated",
      "approved",
    ] satisfies ArticleIdeaStatus[] as string[])
    .is("archived_at", null);

  if (error) throw error;
  return count ?? 0;
}

// ============================================================================
// generateArticleIdeas — the canonical orchestration
//
// Called from:
//   - Autopilot scheduler: still calls `generateArticleIdeas` directly
//     (synchronous in-cron-tick semantics — the scheduler already runs
//     in the background, no need for a second workflow hop).
//   - Manual UI: now uses the queue + workflow split below
//     (`queueGenerateArticleIdeas` + `runGenerateArticleIdeasJob`)
//     so the modal can close immediately after the job is durable.
//
// Both paths share `_executeArticleIdeasJob` so the AI/token/insert
// logic lives in exactly one place. All three paths produce identical
// state transitions in `article_jobs`, `article_ideas`,
// `token_transactions`, and `usage_events`.
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
 * Used by the autopilot scheduler (one-shot synchronous call inside
 * a cron tick). The manual UI now goes through
 * {@link queueGenerateArticleIdeas} + {@link runGenerateArticleIdeasJob}
 * so the modal can close immediately after the durable job is queued.
 *
 * Both paths funnel into {@link _executeArticleIdeasJob}, so token
 * consumption / Claude / insert / usage logging stay in one place.
 *
 * Order of operations (deliberate — see comments inline):
 *   1. Resolve blog context (fail fast if blog is missing).
 *   2. Insert `article_jobs` row with full input snapshot.
 *   3-8. Delegate to `_executeArticleIdeasJob` — see its docblock.
 *
 * Refund behavior: this entry point inherits whatever
 * `_executeArticleIdeasJob` does. By default the job runner refunds
 * credits on AI/insert failure (added in v1.1) — autopilot benefits
 * from that too, so a flaky Claude call doesn't double-charge a team
 * whose backlog top-up gets retried by the scheduler on the next tick.
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

  return _executeArticleIdeasJob({
    jobId: job.id,
    blogId: input.blogId,
    teamId: input.teamId,
    userId: input.userId,
    triggerSource: input.triggerSource,
    brief: input.brief,
    count,
    blogContext: ctx,
    client: supabase,
    anthropicProvider: input.anthropicProvider,
  });
}

// ============================================================================
// Queue + run split for the manual UI path (mirrors generateArticleDraftFromIdea).
//
//   Phase 1 — `queueGenerateArticleIdeas`
//     Synchronous, runs inside the server action. Validates blog,
//     creates the durable `article_jobs` row, returns immediately so
//     the modal can close. NO tokens consumed. NO Claude call.
//     Idempotent per-blog: a second click while a generate_ideas job
//     is already pending/processing for the blog returns the existing
//     job id with `alreadyQueued: true`.
//
//   Phase 2 — `runGenerateArticleIdeasJob`
//     The unit of work the Vercel Workflow step calls. Loads the
//     pending job row by id, calls `_executeArticleIdeasJob` to
//     consume tokens / call Claude / insert / log usage / complete.
//     On failure: marks job failed and refunds the consumed credits
//     (idempotent on `refund::article_job::{jobId}`).
// ============================================================================

export interface QueueGenerateArticleIdeasInput {
  blogId: string;
  teamId: string;
  userId: string;
  brief?: string;
  count?: number;
  triggerSource: TriggerSource;
  /** Free-form metadata stamped onto `article_jobs.input`. */
  jobMetadata?: Record<string, unknown>;
  client?: Client;
}

export interface QueueGenerateArticleIdeasResult {
  jobId: string;
  blogId: string;
  /** Resolved batch size (after defaulting). */
  count: number;
  status: "pending" | "processing";
  /**
   * `true` when a pending/processing `generate_ideas` job already
   * existed for this blog and we returned it instead of creating a
   * new one. The caller skips starting another workflow run.
   */
  alreadyQueued: boolean;
}

/**
 * Creates the durable `article_jobs` row for a generate_ideas request.
 * Does NOT consume tokens, call Claude, or start the workflow — the
 * caller is responsible for kicking off `generateIdeasWorkflow`.
 *
 * Idempotency: a second call while a `pending` or `processing`
 * `generate_ideas` job already exists for this blog returns the
 * existing job id with `alreadyQueued: true`. Per-blog (not per-brief)
 * because it'd be confusing for two parallel "Generate ideas" clicks
 * to land two batches in the user's review queue at once. Operators
 * who want true parallelism can call `generateArticleIdeas` directly
 * (autopilot path).
 *
 * Throws:
 *   * `Error("blog_not_found")` — propagated as-is.
 *   * Other supabase errors — propagated as-is.
 */
export async function queueGenerateArticleIdeas(
  input: QueueGenerateArticleIdeasInput,
): Promise<QueueGenerateArticleIdeasResult> {
  const supabase = input.client ?? createAdminClient();
  const count = input.count ?? IDEA_DEFAULT_COUNT;

  // 1. Resolve blog context — fail fast with a typed message.
  const ctx = await getBlogGenerationContext(input.blogId, supabase);
  if (!ctx) throw new Error("blog_not_found");

  // 2. Idempotency: short-circuit if there's already an in-flight
  // generate_ideas job for this blog. Prevents the user from racking
  // up duplicate review batches by double-clicking Generate Ideas.
  const { data: existingJobs, error: existingJobsErr } = await supabase
    .from("article_jobs")
    .select("id, status")
    .eq("blog_id", input.blogId)
    .eq("type", "generate_ideas")
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (existingJobsErr) throw existingJobsErr;
  if (existingJobs && existingJobs.length > 0) {
    const existing = existingJobs[0];
    return {
      jobId: existing.id,
      blogId: input.blogId,
      count,
      status: existing.status as "pending" | "processing",
      alreadyQueued: true,
    };
  }

  // 3. Insert the job row with the full input snapshot. Same shape as
  // `generateArticleIdeas` so the run-phase loader can rehydrate the
  // execution from the row alone (workflow replay safety).
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

  return {
    jobId: job.id,
    blogId: input.blogId,
    count,
    status: "pending",
    alreadyQueued: false,
  };
}

export interface RunGenerateArticleIdeasJobInput {
  /** Pre-existing job row from {@link queueGenerateArticleIdeas}. */
  jobId: string;
  blogId: string;
  teamId: string;
  userId: string;
  brief?: string | null;
  count?: number;
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
 * The unit of work the Vercel Workflow step calls. Loads the existing
 * pending job row, then funnels into {@link _executeArticleIdeasJob}
 * — same body as the legacy synchronous orchestration's "try" block.
 *
 * Idempotent on `jobId`:
 *   * `consume_team_tokens` is idempotent on `article_job::{jobId}`.
 *   * `article_ideas` rows insert with no idempotency key (a workflow
 *     replay would double-insert) — but workflow steps are wrapped in
 *     `FatalError` so retries are disabled. The caller's failure is
 *     terminal, with the user able to click Generate Ideas again.
 *
 * NOTE on retries: callers (the workflow step in particular) MUST
 * NOT retry this function on failure. The catch block already
 * refunds the user.
 */
export async function runGenerateArticleIdeasJob(
  input: RunGenerateArticleIdeasJobInput,
): Promise<GenerateArticleIdeasResult> {
  const supabase = input.client ?? createAdminClient();

  // Re-resolve context inside the workflow process — we don't trust
  // anything from the queue's call site to still be in scope.
  const ctx = await getBlogGenerationContext(input.blogId, supabase);
  if (!ctx) throw new Error("blog_not_found");

  // Optionally enrich the job's input jsonb with workflow metadata
  // (workflowRunId, autopilotRunId) so an operator inspecting the row
  // can connect the job to its execution context.
  if (input.jobInputPatch && Object.keys(input.jobInputPatch).length > 0) {
    await mergeArticleJobInput(supabase, input.jobId, input.jobInputPatch);
  }

  return _executeArticleIdeasJob({
    jobId: input.jobId,
    blogId: input.blogId,
    teamId: input.teamId,
    userId: input.userId,
    triggerSource: input.triggerSource ?? "workflow",
    brief: input.brief ?? undefined,
    count: input.count ?? IDEA_DEFAULT_COUNT,
    blogContext: ctx,
    client: supabase,
    anthropicProvider: input.anthropicProvider,
    refundOnFailure: true,
  });
}

interface ExecuteArticleIdeasJobInput {
  jobId: string;
  blogId: string;
  teamId: string;
  userId: string;
  triggerSource: TriggerSource;
  brief?: string;
  count: number;
  blogContext: BlogGenerationContext;
  client: Client;
  anthropicProvider?: AnthropicLike;
  /**
   * When true (the workflow run path), failures after token
   * consumption issue a `refundTeamTokens` call. Defaults to true —
   * the autopilot path passes nothing (relying on the default) so a
   * scheduler-driven AI failure also gets refunded; v1 of this
   * service silently ate the credit, which was a known gap.
   */
  refundOnFailure?: boolean;
}

/**
 * Shared executor used by both `generateArticleIdeas` (autopilot) and
 * `runGenerateArticleIdeasJob` (workflow). The job row already exists;
 * this function runs the consume → AI → insert → log → complete
 * pipeline with one set of refund-on-failure semantics.
 */
async function _executeArticleIdeasJob(
  input: ExecuteArticleIdeasJobInput,
): Promise<GenerateArticleIdeasResult> {
  const supabase = input.client;
  const { jobId, blogContext: ctx, count } = input;
  const refundOnFailure = input.refundOnFailure !== false;

  let consumed = false;
  const creditsUsed = getCreditCost("generateIdeas");

  try {
    // 1. Move into processing. Stamp `started_at`, bump attempts.
    await updateArticleJobStatus({
      jobId,
      status: "processing",
      currentStep: "loading_context",
      incrementAttempts: true,
      client: supabase,
    });

    // 2. Reserve credits BEFORE the AI call so an out-of-tokens team
    // doesn't burn a Claude request. The RPC is atomic — the only way
    // to reach step 3 is with a successful debit. The job id is the
    // idempotency key so a workflow replay (same job id) no-ops.
    try {
      await consumeTeamTokens({
        teamId: input.teamId,
        amount: creditsUsed,
        actingUserId: input.userId,
        description: `Generate ${count} article ideas for blog "${ctx.blog.name}"`,
        metadata: {
          blog_id: input.blogId,
          job_id: jobId,
          job_type: "generate_ideas",
          trigger_source: input.triggerSource,
        },
        idempotencyKey: `article_job::${jobId}`,
        client: supabase,
      });
      consumed = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await failArticleJob({
        jobId,
        errorMessage: message,
        client: supabase,
      });
      throw err;
    }

    // 3. Call the AI provider.
    await updateArticleJobStatus({
      jobId,
      currentStep: "generating_ideas",
      client: supabase,
    });

    const batch = await generateIdeas({
      blogName: ctx.blog.name,
      blogDescription: ctx.blog.description || undefined,
      blogNiche: ctx.blog.niche || undefined,
      blogKeywords: ctx.blog.keywords.length ? ctx.blog.keywords : undefined,
      legacyAiPromptTemplate: ctx.blog.aiPromptTemplate || undefined,
      settings: ctx.settings,
      brief: input.brief,
      count,
      anthropicProvider: input.anthropicProvider,
    });

    // 4. Persist the batch. We insert the raw provider response on
    // each row's `raw_ai_response` so the future "regenerate just this
    // idea" flow has the original payload to anchor on.
    await updateArticleJobStatus({
      jobId,
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
        jobId,
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

    // 5. Audit log. Failure here is logged but doesn't fail the job —
    // the user got their ideas, the audit row is recoverable later.
    await updateArticleJobStatus({
      jobId,
      currentStep: "logging_usage",
      client: supabase,
    });

    await logUsageEvent({
      userId: input.userId,
      blogId: input.blogId,
      jobId,
      provider: PROVIDER_ANTHROPIC,
      model: batch.model,
      inputTokens: batch.promptTokens,
      outputTokens: batch.completionTokens,
      creditsUsed,
      client: supabase,
    });

    // 6. Done.
    await completeArticleJob({
      jobId,
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
      jobId,
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
        jobId,
        errorMessage: message,
        client: supabase,
      });
      /* v8 ignore start -- defensive: secondary failure during fail-marking */
    } catch {
      // Swallow — the primary error is what the caller cares about.
    }
    /* v8 ignore stop */

    if (consumed && refundOnFailure) {
      try {
        await refundTeamTokens({
          teamId: input.teamId,
          amount: creditsUsed,
          actingUserId: input.userId,
          description: `Refund for failed idea-generation job ${jobId}: ${message}`,
          metadata: {
            refunded_for_job_id: jobId,
            refunded_for_blog_id: input.blogId,
            refunded_for_job_type: "generate_ideas",
            reason: message,
          },
          idempotencyKey: `refund::article_job::${jobId}`,
          client: supabase,
        });
        await markJobRefunded(supabase, jobId, creditsUsed);
        /* v8 ignore start -- defensive: secondary failure during refund */
      } catch {
        // Swallow — operators reconcile via token_transactions.
      }
      /* v8 ignore stop */
    }

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
  /**
   * Status the durable job/article rows are in after queueing.
   * `'completed'` is returned when an already-completed job exists
   * for the idea (autopilot dedupe path) and the caller should
   * skip starting another workflow.
   */
  status: "pending" | "processing" | "completed";
  /**
   * `true` when a `pending` / `processing` / `completed` job
   * already existed for this idea and we returned it instead of
   * creating a new one. Lets the server action skip starting a
   * duplicate workflow run.
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
  // Archived ideas are excluded from autopilot AND manual generation.
  // The dashboard hides Generate Article on archived cards, but defend
  // here too — a stale autopilot tick may try to queue an idea the
  // user archived between `listApprovedIdeasForBlog` and this call.
  // `!= null` treats `null` and `undefined` (missing column on legacy
  // rows / older test fixtures) the same — only a real timestamp
  // signals "archived".
  if (ideaRow.archived_at != null) {
    throw new Error("idea_archived");
  }
  const idea = ideaRow as ArticleIdeaRow;

  // 3. Idempotency: short-circuit if a pending / processing /
  // completed job already exists for this idea.
  //
  //   * `pending` / `processing` — prevents double-charging when
  //     the user double-clicks Generate Article (or two tabs both
  //     fire it), AND prevents overlapping autopilot cron ticks
  //     from spawning duplicates while a prior tick's workflow is
  //     still running.
  //   * `completed` — defends against a race where an idea was
  //     converted but its `article_ideas.status` flip to
  //     `converted_to_article` hasn't propagated yet (or a future
  //     contract change leaves it `approved` post-completion).
  //     Without this guard, the next cron tick could re-spawn a
  //     duplicate generation for an already-converted idea.
  //
  // `failed` / `cancelled` jobs are deliberately NOT in the list:
  // autopilot v1 retries those automatically by re-queueing from
  // the same `approved` idea on the next cron tick. The new job
  // re-uses the existing article placeholder via the article_id
  // link the workflow looks up.
  const { data: existingJobs, error: existingJobsErr } = await supabase
    .from("article_jobs")
    .select("id, article_id, status")
    .eq("article_idea_id", input.ideaId)
    .eq("type", "generate_article")
    .in("status", ["pending", "processing", "completed"])
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
      status: existing.status as "pending" | "processing" | "completed",
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
  // Race guard: the user can archive an approved idea after the job
  // queued but before the workflow runs. Bail rather than generating
  // an article the dashboard has stamped as "removed from backlog".
  // Treat both `null` and `undefined` as "not archived" — the column
  // is nullable in Postgres but legacy/pre-migration test fixtures
  // may not include it in the row at all.
  if (ideaRow.archived_at != null) {
    throw new Error("idea_archived");
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
      blogNiche: ctx.blog.niche || undefined,
      blogKeywords: ctx.blog.keywords.length ? ctx.blog.keywords : undefined,
      legacyAiPromptTemplate: ctx.blog.aiPromptTemplate || undefined,
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

    // Best-effort image selection. Runs AFTER the draft is saved
    // (so the picker can read the freshly-written body for H2
    // extraction) and BEFORE `logging_usage` (so the image
    // summary lands in the same `output` payload as token usage).
    //
    // CRITICAL: `pickImagesForArticle` is documented as
    // never-throws. The outer try wraps the helper anyway so a
    // future regression can't accidentally pull the article
    // generation into the refund branch — image-picker failures
    // are pure UX nits, not billing events. Tokens were consumed
    // for the LLM work, which already succeeded; refunding on an
    // Unsplash rate-limit would be the wrong trade-off.
    //
    // Gate on the blog's `settings.media.autoPickImages` +
    // `settings.media.imageProvider` (loaded into `ctx.settings`
    // up top via `getBlogGenerationContext`). Either OFF / `none`
    // short-circuits to a synthetic empty summary so the
    // completion `output` still carries a structured
    // `imageSummary` field (consumers + future debug tooling
    // can rely on its presence regardless of the setting).
    await updateArticleJobStatus({
      jobId: input.jobId,
      currentStep: "picking_images",
      client: supabase,
    });
    const mediaSettings = ctx.settings.media;
    const autopilotImagesEnabled =
      mediaSettings.autoPickImages && mediaSettings.imageProvider !== "none";
    let imageSummary: PickImagesForArticleResult;
    if (!autopilotImagesEnabled) {
      imageSummary = {
        providerId: mediaSettings.imageProvider,
        featuredSelected: false,
        sectionsFound: 0,
        sectionImagesSelected: 0,
        warnings: [],
      };
    } else {
      try {
        imageSummary = await pickImagesForArticle({
          articleId: input.articleId,
          blogId: input.blogId,
          providerId: mediaSettings.imageProvider,
          includeFeatured: true,
          includeSections: mediaSettings.includeInlineImages,
          client: supabase,
        });
        /* v8 ignore start -- defensive: pickImagesForArticle never throws by contract; this catch is a future-regression guard so an image bug can't accidentally refund tokens */
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        imageSummary = {
          providerId: mediaSettings.imageProvider,
          featuredSelected: false,
          sectionsFound: 0,
          sectionImagesSelected: 0,
          warnings: [`Image selection threw unexpectedly: ${message}`],
        };
      }
      /* v8 ignore stop */
    }

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

    // Best-effort autopilot WordPress draft auto-send. Runs AFTER
    // image picking + usage logging so an auto-send failure can't
    // leave token usage un-logged. Gated on `triggerSource`,
    // automation/publishing settings, and the presence of a
    // WordPress connection — see `maybeSendAutopilotWordPressDraft`
    // for the full gate matrix.
    //
    // CRITICAL: like the image picker, this step never fails the
    // article job. WordPress can be unreachable, rate-limited, or
    // the user might delete the credentials between cron runs —
    // none of those should refund tokens or roll back the saved
    // article. The helper always returns a structured result that
    // becomes `output.wpPublish`.
    const wpPublishResult = await maybeSendAutopilotWordPressDraft({
      input,
      ctx,
      supabase,
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
        // Image-picker summary lives in the same `output` payload
        // so a future support-debug surface (or autopilot run
        // detail drawer) can show which images were picked vs
        // skipped without a second query.
        imageSummary: {
          providerId: imageSummary.providerId,
          featuredSelected: imageSummary.featuredSelected,
          sectionsFound: imageSummary.sectionsFound,
          sectionImagesSelected: imageSummary.sectionImagesSelected,
          warnings: imageSummary.warnings,
        },
        // Autopilot WP-draft auto-send result (or `undefined` when
        // no auto-send was attempted — manual trigger, requireReview
        // on, or feature flag off). The drawer + tray subtitle
        // helpers shape-check `output.wpPublish` defensively, so
        // omitting the key on the "didn't try" path is fine.
        ...(wpPublishResult ? { wpPublish: wpPublishResult } : {}),
        // Schema-repair retry visibility. Stamped only when the
        // first generation attempt threw a schema validation
        // error and the second (stricter) attempt succeeded — the
        // bulk of jobs land here as one-shot wins and skip both
        // keys. See `lib/ai/provider.ts` for the retry policy.
        ...(draft.retried
          ? { retried: true, retryCount: draft.retryCount }
          : {}),
      },
      client: supabase,
    });

    // Best-effort: roll the per-job `wpPublish` outcome up to the
    // `blog_autopilot_runs.wp_drafts_*` counters so the recent-
    // runs panel + detail drawer can show "X drafts created · Y
    // failed" without recomputing on every render. The helper is
    // absolute-write + idempotent — concurrent autopilot jobs
    // each running this sync will converge on the same totals.
    //
    // CRITICAL: failure here NEVER fails the article job. The
    // article generation + token consumption + WordPress publish
    // have all already settled by this point; a counter-sync miss
    // is a UX nit, not a billing event. Wrapped in try/catch so a
    // future regression in the sync helper can't drag the
    // article job into the outer refund branch.
    const autopilotRunId = readAutopilotRunIdFromJobInputPatch(
      input.jobInputPatch,
    );
    if (autopilotRunId) {
      await syncAutopilotRunWpDraftCountersBestEffort({
        runId: autopilotRunId,
        blogId: input.blogId,
        client: supabase,
      });
    }

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

    // If the error is one of the recognized structured-output
    // failures (schema-mismatch OR truncated output), stamp
    // structured metadata onto the job's `output` BEFORE marking
    // it failed. The recent-jobs queue + autopilot run drawer
    // surface these keys so an operator can tell at a glance which
    // failure mode hit and whether a retry was attempted.
    //
    // Best-effort: a transient supabase blip on the merge would
    // mask the original `err` from the outer caller. We swallow
    // metadata-write failures in the same posture as the existing
    // refund + fail-marking blocks below.
    const failureKind = getArticleGenerationFailureKind(err);
    if (failureKind === "schema_mismatch") {
      const isRetryFailure = err instanceof SchemaRetryFailedError;
      const originalErrorMessage = isRetryFailure
        ? err.originalErrorMessage
        : message;
      const finalErrorMessage = isRetryFailure
        ? err.finalErrorMessage
        : message;
      try {
        await mergeArticleJobOutput(supabase, input.jobId, {
          failureKind: "schema_mismatch",
          retried: isRetryFailure,
          retryCount: isRetryFailure ? err.retryCount : 0,
          originalErrorMessage,
          finalErrorMessage,
        });
        /* v8 ignore start -- defensive: secondary failure during failure-metadata stamp */
      } catch {
        // Swallow.
      }
      /* v8 ignore stop */
    } else if (failureKind === "truncated_output") {
      // failureKind === "truncated_output" is only returned for these
      // two error classes (see `getArticleGenerationFailureKind`), so
      // the casts below are total. `truncationErr` is the FINAL
      // attempt's error (drives the top-level detection fields);
      // `originalTruncation` is the first attempt's, surfaced only on
      // the retry path so an operator can see how the two attempts
      // differed (e.g. one finishReason=length, one finishReason=stop).
      const isRetryFailure = err instanceof TruncationRetryFailedError;
      const truncationErr: TruncatedArticleOutputError = isRetryFailure
        ? err.retryError
        : (err as TruncatedArticleOutputError);
      const originalTruncation: TruncatedArticleOutputError = isRetryFailure
        ? err.originalError
        : truncationErr;
      try {
        await mergeArticleJobOutput(supabase, input.jobId, {
          failureKind: "truncated_output",
          retried: isRetryFailure,
          retryCount: isRetryFailure ? err.retryCount : 0,
          originalErrorMessage: isRetryFailure
            ? err.originalErrorMessage
            : message,
          finalErrorMessage: isRetryFailure ? err.finalErrorMessage : message,
          // Detection metadata is the high-value signal — surfacing it
          // here lets ops see WHY the guard fired without having to
          // grep Vercel logs for the matching `console.warn` line.
          truncationDetection: {
            finishReason: truncationErr.finishReason,
            actualWords: truncationErr.actualWords,
            expectedWords: truncationErr.expectedWords,
            contentMarkdownPreview: truncationErr.contentMarkdownPreview,
            ...(isRetryFailure
              ? {
                  originalAttempt: {
                    finishReason: originalTruncation.finishReason,
                    actualWords: originalTruncation.actualWords,
                    expectedWords: originalTruncation.expectedWords,
                    contentMarkdownPreview:
                      originalTruncation.contentMarkdownPreview,
                  },
                }
              : {}),
          },
        });
        /* v8 ignore start -- defensive: secondary failure during failure-metadata stamp */
      } catch {
        // Swallow.
      }
      /* v8 ignore stop */
    }

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

/**
 * Result shape recorded in `article_jobs.output.wpPublish`. Only
 * surfaces when the auto-send path actually ran (one of: succeeded,
 * already had a draft, found no connection, or failed). The
 * orchestrator returns `null` from {@link maybeSendAutopilotWordPressDraft}
 * for the "didn't try" cases (manual trigger, requireReview on,
 * setting off) and the completion payload omits `wpPublish`
 * entirely in those cases.
 */
export type AutopilotWordPressPublishResult =
  | {
      attempted: true;
      status: "draft_created";
      wpPostId: number;
      wpPostUrl: string | null;
    }
  | {
      attempted: false;
      status: "already_sent";
      wpPostId: number;
      wpPostUrl: string | null;
    }
  | { attempted: false; status: "skipped_no_connection"; warning: string }
  | { attempted: true; status: "failed"; warning: string };

interface MaybeSendAutopilotWpDraftOpts {
  input: RunGenerateArticleFromIdeaJobInput;
  ctx: BlogGenerationContext;
  supabase: Client;
}

/**
 * The autopilot WordPress-draft auto-send step. Returns:
 *
 *   * `null` when ANY of the gates fail (manual trigger, autopilot
 *     mode off, autopilot disabled, requireReview on, setting off).
 *     The completion `output.wpPublish` key is omitted in this
 *     case — there's nothing to surface in the UI for "we didn't
 *     even try."
 *   * A `{status: 'skipped_no_connection'}` warning when the setting
 *     is on but the blog has no WordPress credentials. The user
 *     wanted us to publish — surface that nothing happened.
 *   * A `{status: 'already_sent'}` result when `articles.wp_post_id`
 *     is already populated (the article was previously sent —
 *     workflow retry, manual pre-send, etc.). v1 doesn't update
 *     existing drafts from the autopilot path; the user can update
 *     manually from the article detail page.
 *   * `{status: 'draft_created'}` on success.
 *   * `{status: 'failed'}` with a user-friendly message on any
 *     `PublishArticleError`. NEVER throws — the article job
 *     continues to completion regardless.
 *
 * Idempotency: we read `articles.wp_post_id` immediately before the
 * publish call (NOT from `ctx`, which loaded the row before the
 * draft was even saved) so a workflow retry that succeeded the
 * first time short-circuits to `already_sent` instead of creating
 * a duplicate WP draft.
 */
async function maybeSendAutopilotWordPressDraft(
  opts: MaybeSendAutopilotWpDraftOpts,
): Promise<AutopilotWordPressPublishResult | null> {
  const { input, ctx, supabase } = opts;

  // Gate matrix. ANY false short-circuits to "didn't try".
  if (input.triggerSource !== "autopilot") return null;
  const auto = ctx.settings.automation;
  const pub = ctx.settings.publishing;
  if (auto.mode !== "autopilot") return null;
  if (!auto.enabled) return null;
  if (auto.requireReview) return null;
  if (!pub.autoSendToWordPressDraft) return null;

  await updateArticleJobStatus({
    jobId: input.jobId,
    currentStep: "sending_to_wordpress",
    client: supabase,
  });

  // Connection presence check. The publish service throws
  // `no_wp_connection` if missing, but we'd rather emit a typed
  // `skipped_no_connection` warning than catch a generic
  // PublishArticleError — easier for the drawer UX.
  const connected = await hasBlogWordPressConnection(input.blogId, supabase);
  if (!connected) {
    return {
      attempted: false,
      status: "skipped_no_connection",
      warning: PUBLISH_ARTICLE_ERROR_COPY.no_wp_connection,
    };
  }

  // Idempotency check. Read the freshly-saved article row to see if
  // `wp_post_id` is already set (workflow retry / manual pre-send).
  // v1 never auto-updates an existing draft — the user can do that
  // manually from the article detail page.
  const { data: existing, error: readErr } = await supabase
    .from("articles")
    .select("wp_post_id, wp_post_url")
    .eq("id", input.articleId)
    .eq("blog_id", input.blogId)
    .maybeSingle();
  /* v8 ignore start -- defensive: article row was just written in this same orchestrator; a read failure here would be a brand-new RLS regression */
  if (readErr) {
    return {
      attempted: false,
      status: "skipped_no_connection",
      warning: `Could not check article state: ${readErr.message ?? "unknown error"}`,
    };
  }
  /* v8 ignore stop */
  if (existing?.wp_post_id) {
    return {
      attempted: false,
      status: "already_sent",
      wpPostId: existing.wp_post_id,
      wpPostUrl: existing.wp_post_url ?? null,
    };
  }

  // Actually send. Map any `PublishArticleError` to a friendly
  // string for the UI; never re-throw.
  try {
    const result = await publishArticleToWordPressDraft({
      articleId: input.articleId,
      blogId: input.blogId,
      client: supabase,
    });
    return {
      attempted: true,
      status: "draft_created",
      wpPostId: result.wpPostId,
      wpPostUrl: result.wpPostUrl,
    };
  } catch (err) {
    /* v8 ignore next 8 -- defensive: publishArticleToWordPressDraft only throws PublishArticleError; the !instanceof branch is a future-regression guard */
    if (!(err instanceof PublishArticleError)) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        attempted: true,
        status: "failed",
        warning: `WordPress draft send failed: ${message}`,
      };
    }
    return {
      attempted: true,
      status: "failed",
      warning: PUBLISH_ARTICLE_ERROR_COPY[err.code],
    };
  }
}

/**
 * Extracts `autopilotRunId` (string) from the merged
 * `jobInputPatch` payload — that's where the workflow stamps it
 * after computing `workflowMetadata` in `generate-article.ts`.
 * Returns `null` for any non-string value so a malformed patch
 * (or a manual run with no `jobInputPatch`) silently skips the
 * counter-sync hook.
 *
 * The autopilot scheduler is the only producer of this key today;
 * a future caller that wants its own runs counted can pass the
 * same shape through `jobInputPatch`.
 */
function readAutopilotRunIdFromJobInputPatch(
  patch: Record<string, unknown> | undefined,
): string | null {
  if (!patch) return null;
  const v = patch.autopilotRunId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Best-effort wrapper around `syncAutopilotRunWordPressDraftCounters`.
 * Swallows any error so a counter-sync failure can never refund
 * tokens or fail the article job. Logs nothing today — operators
 * can reconcile via the future admin reconciler if a row's
 * counters look stale (the same helper is safe to re-run).
 */
async function syncAutopilotRunWpDraftCountersBestEffort(input: {
  runId: string;
  blogId: string;
  client: Client;
}): Promise<void> {
  /* v8 ignore start -- defensive: counter sync is best-effort; any thrown error here would mask a successful article job, so we swallow at the outermost layer */
  try {
    await syncAutopilotRunWordPressDraftCounters({
      runId: input.runId,
      blogId: input.blogId,
      client: input.client,
    });
  } catch {
    // Swallow — the article publish itself succeeded.
  }
  /* v8 ignore stop */
}

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
  await mergeArticleJobOutput(client, jobId, {
    refunded: true,
    refundedCredits,
    refundedAt: new Date().toISOString(),
  });
}

/**
 * Read-then-write merge of an arbitrary patch into
 * `article_jobs.output`. Used by:
 *   * {@link markJobRefunded} — `refunded` / `refundedCredits` /
 *     `refundedAt` after a refund settles.
 *   * The schema-retry failure path in
 *     {@link runGenerateArticleFromIdeaJob} — `failureKind` /
 *     `retried` / `retryCount` / `originalErrorMessage` /
 *     `finalErrorMessage` so an operator reading the failed job
 *     can tell at a glance whether the schema-repair retry was
 *     attempted.
 *
 * Read-then-write is safe because each job row has exactly one
 * writer at a time (the workflow step). Concurrent writes from a
 * stuck-job reconciler use `markJobRefunded` instead, which adds
 * to the same map without colliding on these keys.
 */
async function mergeArticleJobOutput(
  client: Client,
  jobId: string,
  patch: Record<string, unknown>,
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
        ...patch,
      } as Json,
    })
    .eq("id", jobId);
  /* v8 ignore next -- defensive throw; swallowed by caller's refund try/catch */
  if (updateErr) throw updateErr;
}

// ============================================================================
// Stuck-job reconciler — protected cron entry point
//
// Why we need this:
//
//   The Vercel Workflow runner can die between steps for reasons we
//   don't control (deployment swap, runtime crash, infra incident).
//   When that happens, the `article_jobs` row stays in `pending` /
//   `processing` forever and the global tray spins on it indefinitely.
//
//   This reconciler is the safety net. Cron pings it every few
//   minutes; it finds rows that haven't moved in N minutes, marks
//   them failed, marks the in-flight article failed too, and refunds
//   any credits that were consumed but never refunded.
//
//   Refund detection goes through the token ledger (NOT the job's
//   own state) so a previous failure that already refunded doesn't
//   get double-refunded. Since `refundTeamTokens` is itself
//   idempotent on the refund key, even a slip wouldn't actually
//   double-credit — but skipping the call when we know we already
//   paid up keeps the audit log clean.
// ============================================================================

/**
 * Default "how stale must a job be before we treat it as stuck" by
 * job type. Generate-article workflows can legitimately take ~60 s of
 * Claude time; we wait 10 min before assuming the runner died.
 * Generate-ideas is faster (~10 s typical), so 5 min is plenty.
 */
export const DEFAULT_RECONCILE_THRESHOLDS_MINUTES: Record<string, number> = {
  generate_article: 10,
  generate_ideas: 5,
};

const RECONCILE_DEFAULT_LIMIT = 50;

const STUCK_ERROR_MESSAGE =
  "Generation timed out or the workflow stopped before completion.";

export interface ReconcileStuckArticleJobsInput {
  /**
   * Override the threshold for ALL job types in this run. When omitted,
   * each type uses its own value from {@link DEFAULT_RECONCILE_THRESHOLDS_MINUTES}.
   */
  olderThanMinutes?: number;
  /**
   * Restrict to one job type. When omitted, both `generate_article`
   * and `generate_ideas` are reconciled in the same run.
   */
  jobType?: ArticleJobType;
  /** Cap rows scanned per run. Defaults to 50 — generous for v1. */
  limit?: number;
  client?: Client;
}

export interface ReconcileStuckArticleJobsResult {
  jobsChecked: number;
  jobsFailed: number;
  articlesFailed: number;
  tokensRefunded: number;
  errors: string[];
}

/**
 * Finds article_jobs that have been stuck in pending/processing past
 * their type's stale threshold, marks them failed, marks the
 * in-flight article failed (when one was already created), and
 * refunds any consumed-but-not-yet-refunded credits.
 *
 * Idempotent across runs:
 *   * The job-fail update is a no-op for rows already marked failed
 *     (the WHERE clause filters them out).
 *   * The refund goes through `refundTeamTokens`, which uses
 *     `refund::article_job::{jobId}` as its idempotency key.
 *   * We also check the token ledger before calling refundTeamTokens,
 *     so an already-refunded job doesn't even cause a write attempt.
 */
export async function reconcileStuckArticleJobs(
  input: ReconcileStuckArticleJobsInput = {},
): Promise<ReconcileStuckArticleJobsResult> {
  const supabase = input.client ?? createAdminClient();
  const limit = input.limit ?? RECONCILE_DEFAULT_LIMIT;
  const result: ReconcileStuckArticleJobsResult = {
    jobsChecked: 0,
    jobsFailed: 0,
    articlesFailed: 0,
    tokensRefunded: 0,
    errors: [],
  };

  // Build the cutoff per job type. When `olderThanMinutes` is passed,
  // use it for everything in this run.
  const typesToScan: ArticleJobType[] = input.jobType
    ? [input.jobType]
    : ["generate_article", "generate_ideas"];

  for (const type of typesToScan) {
    // Every supported job type has a default in
    // DEFAULT_RECONCILE_THRESHOLDS_MINUTES — adding a new type to
    // `typesToScan` MUST also add a default to that map. Falling
    // back to a hardcoded N here would silently mask a missing
    // entry, so we don't.
    const minutes =
      input.olderThanMinutes ?? DEFAULT_RECONCILE_THRESHOLDS_MINUTES[type];
    const cutoffIso = new Date(Date.now() - minutes * 60_000).toISOString();

    const { data: stuckJobs, error: fetchErr } = await supabase
      .from("article_jobs")
      .select(
        "id, type, blog_id, article_id, article_idea_id, input, output, started_at, created_at",
      )
      .eq("type", type)
      .in("status", ["pending", "processing"])
      .lt("created_at", cutoffIso)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (fetchErr) {
      result.errors.push(`fetch_${type}: ${fetchErr.message}`);
      continue;
    }
    /* v8 ignore next 1 -- defensive: supabase returns data when error is null */
    const rows = stuckJobs ?? [];

    for (const job of rows) {
      result.jobsChecked += 1;
      try {
        await reconcileSingleStuckJob(supabase, job, result);
      } catch (err) {
        result.errors.push(`job_${job.id}: ${describeErr(err)}`);
      }
    }
  }

  return result;
}

/**
 * Supabase / PostgREST errors are plain `{ message, ... }` objects,
 * NOT `Error` instances. `String({})` returns `"[object Object]"`,
 * which is useless in the result's `errors[]`. Pull the `.message`
 * field when it's present on a non-Error throw.
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

interface StuckJobRow {
  id: string;
  type: string;
  blog_id: string;
  article_id: string | null;
  article_idea_id: string | null;
  input: Json;
  output: Json;
  started_at: string | null;
  created_at: string;
}

async function reconcileSingleStuckJob(
  client: Client,
  job: StuckJobRow,
  result: ReconcileStuckArticleJobsResult,
): Promise<void> {
  // 1. Mark the job failed. failArticleJob bumps `error_message` and
  //    `completed_at`; we use it directly so the same audit copy
  //    appears as on a normal-path failure.
  await failArticleJob({
    jobId: job.id,
    errorMessage: STUCK_ERROR_MESSAGE,
    client,
  });
  result.jobsFailed += 1;

  // 2. If the job had a placeholder article in `generating`, flip it
  //    to `failed`. Read first so we don't trample a successful write
  //    that landed a millisecond before the cron tick.
  if (job.article_id) {
    const { data: article, error: articleReadErr } = await client
      .from("articles")
      .select("status")
      .eq("id", job.article_id)
      .maybeSingle();
    if (articleReadErr) throw articleReadErr;

    if (article && article.status === "generating") {
      const { error: updateErr } = await client
        .from("articles")
        .update({ status: "failed", error_message: STUCK_ERROR_MESSAGE })
        .eq("id", job.article_id);
      /* v8 ignore next 3 -- defensive: caller-side error path */
      if (updateErr) {
        throw updateErr;
      }
      result.articlesFailed += 1;
    }
  }

  // 3. Refund any consumed-but-not-yet-refunded credits. The token
  //    ledger is the source of truth — checking the job's own state
  //    would risk double-refunding rows whose `output.refunded` flag
  //    failed to write earlier.
  const usageKey = `article_job::${job.id}`;
  const refundKey = `refund::article_job::${job.id}`;
  const { data: ledger, error: ledgerErr } = await client
    .from("token_transactions")
    .select("idempotency_key, amount, user_id")
    .in("idempotency_key", [usageKey, refundKey]);
  if (ledgerErr) throw ledgerErr;
  const ledgerRows = ledger ?? [];

  const usageRow = ledgerRows.find((r) => r.idempotency_key === usageKey);
  const alreadyRefunded = ledgerRows.some(
    (r) => r.idempotency_key === refundKey,
  );
  /* v8 ignore next 3 -- defensive: nothing to refund / already refunded */
  if (!usageRow || alreadyRefunded) {
    return;
  }

  // The usage row was a debit, so its amount is negative. The refund
  // amount is the absolute value.
  const refundAmount = Math.abs(usageRow.amount);
  /* v8 ignore next 3 -- defensive: a 0-amount usage row is unreachable today */
  if (refundAmount <= 0) {
    return;
  }

  // We need the team_id to call refundTeamTokens. The orchestration
  // snapshots it onto `article_jobs.input.teamId` at queue time.
  const teamId = readTeamIdFromJobInput(job.input);
  if (!teamId) {
    result.errors.push(
      `job_${job.id}: cannot refund — missing teamId on job.input snapshot`,
    );
    return;
  }

  await refundTeamTokens({
    teamId,
    amount: refundAmount,
    actingUserId: usageRow.user_id,
    description: `Refund for stuck article job ${job.id}: ${STUCK_ERROR_MESSAGE}`,
    metadata: {
      refunded_for_job_id: job.id,
      refunded_for_blog_id: job.blog_id,
      refunded_for_idea_id: job.article_idea_id,
      reason: STUCK_ERROR_MESSAGE,
      reconciler: true,
    },
    idempotencyKey: refundKey,
    client,
  });

  // Stamp output.refunded so the global tray badge flips to
  // "Failed · Refunded" without joining the token ledger.
  try {
    await markJobRefunded(client, job.id, refundAmount);
    /* v8 ignore start -- defensive: output stamping is best-effort */
  } catch {
    // Refund itself succeeded; operators reconcile via
    // token_transactions if the secondary stamp didn't land.
  }
  /* v8 ignore stop */

  result.tokensRefunded += refundAmount;
}

function readTeamIdFromJobInput(input: Json): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  return typeof obj.teamId === "string" ? obj.teamId : null;
}
