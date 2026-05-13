"use server";

import { revalidatePath } from "next/cache";
import { start } from "workflow/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import {
  type ActiveArticleJobRow,
  type ArticleIdeaStatus,
  listActiveArticleJobsForUser,
  queueGenerateArticleFromIdea,
  queueGenerateArticleIdeas,
  updateArticleIdeaStatus,
} from "@/services/article-generation-service";
import { generateArticleWorkflow } from "@/workflows/generate-article";
import { generateIdeasWorkflow } from "@/workflows/generate-ideas";
import type { ActionResult } from "./workspace";

/**
 * Status values the manual review UI is allowed to assign. The full
 * `ArticleIdeaStatus` union also contains `generated` (regression) and
 * `converted_to_article` (only the convert flow can land an idea
 * there) — this narrower type keeps callers from passing values the
 * service helper would reject anyway.
 */
export type IdeaActionTargetStatus = Extract<
  ArticleIdeaStatus,
  "approved" | "rejected"
>;

/**
 * Manual entry point for the "Generate ideas" UI flow.
 *
 * Two-step shape (mirrors {@link generateArticleFromIdea}):
 *
 *   1. Queue: synchronous create of the durable `article_jobs` row
 *      via {@link queueGenerateArticleIdeas}. Idempotent per-blog —
 *      a second click while a generate_ideas job is already in flight
 *      returns the existing id instead of creating a duplicate batch.
 *   2. Start the Vercel Workflow that consumes tokens and calls
 *      Claude. We skip the start when the queue says
 *      `alreadyQueued: true`.
 *
 * The action returns IMMEDIATELY (no awaiting Claude) so the modal
 * can close and the global active-jobs tray takes over the progress
 * UI. The user can refresh, navigate away, or close the browser
 * without losing the job — durable state lives in `article_jobs`.
 */

const MAX_BRIEF_LENGTH = 2000;

export interface GenerateIdeasManualInput {
  /** Optional topic seed from the modal. Trimmed; empty/whitespace becomes no brief. */
  brief?: string;
  /**
   * Optional override of the batch size. Defaults to the provider's
   * `IDEA_DEFAULT_COUNT`. v1 UI doesn't expose this; we accept it so
   * tests + future power-user UIs don't have to fork the action.
   */
  count?: number;
}

/**
 * Queue-only result. The action returns BEFORE Claude runs, so we
 * can't echo `creditsUsed` / `model` / `ideasGenerated` here — the
 * tray (polling `article_jobs`) surfaces those once the workflow
 * completes. Callers that need the legacy synchronous result shape
 * should call `generateArticleIdeas` directly (autopilot does this).
 */
export interface GenerateIdeasManualResult {
  jobId: string;
  blogId: string;
  /** Resolved batch size after defaulting. */
  count: number;
  /** Status of the durable `article_jobs` row at return time. */
  status: "pending" | "processing";
  /** True when an in-flight generate_ideas job already existed for this blog. */
  alreadyQueued: boolean;
  /** Workflow run id if the SDK exposed one. */
  workflowRunId: string | null;
}

export async function generateIdeasManual(
  teamId: string,
  projectId: string,
  blogId: string,
  input: GenerateIdeasManualInput = {},
): Promise<ActionResult<GenerateIdeasManualResult>> {
  if (
    typeof input.brief === "string" &&
    input.brief.length > MAX_BRIEF_LENGTH
  ) {
    return {
      data: null,
      error: `Brief must be at most ${MAX_BRIEF_LENGTH} characters.`,
    };
  }

  if (
    typeof input.count === "number" &&
    (!Number.isFinite(input.count) || input.count < 1 || input.count > 50)
  ) {
    return {
      data: null,
      error: "Count must be between 1 and 50.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "consume_team_tokens", admin);

    // Phase 1: durable enqueue. Validates the blog (throws
    // `blog_not_found`), creates the `article_jobs` row. No tokens
    // consumed yet.
    const queued = await queueGenerateArticleIdeas({
      blogId,
      teamId,
      userId: user.id,
      brief: input.brief,
      count: input.count,
      triggerSource: "manual",
      client: admin,
    });

    // Phase 2: start the workflow unless one is already in flight for
    // this blog. `alreadyQueued = true` means a previous click is
    // still being processed — re-firing the workflow would target the
    // same job id (consume is idempotent), but the second workflow
    // would race the first one's writes and double-insert ideas.
    let workflowRunId: string | null = null;
    if (!queued.alreadyQueued) {
      try {
        const run = await start(generateIdeasWorkflow, [
          {
            jobId: queued.jobId,
            blogId,
            teamId,
            projectId,
            userId: user.id,
            triggerSource: "manual",
            brief: input.brief ?? null,
            count: queued.count,
          },
        ]);
        workflowRunId =
          (run as { id?: string; runId?: string }).id ??
          (run as { id?: string; runId?: string }).runId ??
          null;
      } catch (err) {
        // Best effort: if the workflow runner is unreachable we leave
        // the job in `pending` so an operator can retry by re-running
        // the workflow with the same job id. The UI shows a friendly
        // error and the user can click Generate Ideas again later
        // (which will hit the idempotency check and re-enqueue).
        const message =
          err instanceof Error ? err.message : "Could not start workflow.";
        return {
          data: null,
          error: `Could not start the idea-generation workflow: ${message}`,
        };
      }
    }

    revalidatePath(
      `/teams/${teamId}/projects/${projectId}/blogs/${blogId}/ideas`,
    );
    revalidatePath(`/teams/${teamId}/projects/${projectId}/blogs/${blogId}`);

    return {
      data: {
        jobId: queued.jobId,
        blogId: queued.blogId,
        count: queued.count,
        status: queued.status,
        alreadyQueued: queued.alreadyQueued,
        workflowRunId,
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { data: null, error: err.code };
    }
    const message =
      err instanceof Error ? err.message : "Could not generate ideas.";
    if (message === "blog_not_found") {
      return { data: null, error: "Blog not found." };
    }
    if (message === "insufficient_tokens") {
      return {
        data: null,
        error:
          "Not enough synth tokens to generate ideas. Top up your balance to continue.",
      };
    }
    return { data: null, error: message };
  }
}

export interface UpdateIdeaStatusResult {
  ideaId: string;
  status: ArticleIdeaStatus;
}

/**
 * Manual approve / reject for a generated idea.
 *
 * The action is intentionally narrow — it accepts only `"approved"` or
 * `"rejected"` (the two manual transitions a reviewer can trigger).
 * `converted_to_article` is owned by the future "Generate article from
 * idea" flow and `generated` is the initial state — neither belongs in
 * a manual UI button. The service's transition matrix enforces the
 * same rules at the data layer.
 *
 * Permission model: `manage_blog`. Editorial decisions about a blog's
 * content sit at the same level as creating posts, so we reuse the
 * existing role binding rather than introducing a new permission key
 * for v1.
 *
 * Returns the new status echoed back so the client can render it
 * optimistically without a refetch (the action also revalidates the
 * paths that read this row).
 */
export async function updateIdeaStatus(
  teamId: string,
  projectId: string,
  blogId: string,
  ideaId: string,
  status: IdeaActionTargetStatus,
): Promise<ActionResult<UpdateIdeaStatusResult>> {
  if (status !== "approved" && status !== "rejected") {
    return {
      data: null,
      error: "Status must be 'approved' or 'rejected'.",
    };
  }

  if (!ideaId) {
    return { data: null, error: "Idea id is required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "manage_blog", admin);

    // Confirm the blog belongs to the project. RLS would also filter
    // this out for a normal user, but we use the admin client below to
    // bypass the article_ideas default-deny — so we have to enforce
    // the team→project→blog chain ourselves.
    const { data: blog } = await admin
      .from("blogs")
      .select("id")
      .eq("id", blogId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (!blog) {
      return { data: null, error: "Blog not found." };
    }

    const updated = await updateArticleIdeaStatus({
      ideaId,
      blogId,
      status,
      client: admin,
    });

    revalidatePath(
      `/teams/${teamId}/projects/${projectId}/blogs/${blogId}/ideas`,
    );
    revalidatePath(`/teams/${teamId}/projects/${projectId}/blogs/${blogId}`);

    return {
      data: {
        ideaId: updated.id,
        status: updated.status as ArticleIdeaStatus,
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { data: null, error: err.code };
    }
    const message =
      err instanceof Error ? err.message : "Could not update idea.";
    if (message === "idea_not_found") {
      return { data: null, error: "Idea not found." };
    }
    if (message.startsWith("invalid_idea_status_transition:")) {
      return {
        data: null,
        error: "This idea can't be changed to that status.",
      };
    }
    return { data: null, error: message };
  }
}

/**
 * Result of the manual "Generate article from idea" action AFTER the
 * shift to Vercel Workflows: returns immediately with the durable job
 * + article ids. The actual generation runs in the background — the
 * UI polls / refreshes Supabase to learn when the article is ready.
 */
export interface GenerateArticleFromIdeaResult {
  jobId: string;
  articleId: string;
  ideaId: string;
  /**
   * Status of the durable `article_jobs` row at the moment this action
   * returned. The workflow may already be processing it by the time
   * the UI reads `article_jobs` (the `start()` call returns as soon as
   * the run is enqueued), so callers should treat both values as
   * "work in progress".
   */
  status: "pending" | "processing";
  /** True when an in-flight job already existed for this idea. */
  alreadyQueued: boolean;
  /** Workflow run id if the SDK exposed one. */
  workflowRunId: string | null;
}

/**
 * Manual entry point for the "Generate article" button on an approved
 * idea card.
 *
 * Two-step shape (see `services/article-generation-service.ts`):
 *
 *   1. Queue: synchronous create of the `article_jobs` + `articles`
 *      placeholders. Idempotent on the idea (a second click while a
 *      job is already pending/processing returns the existing ids).
 *   2. Start the Vercel Workflow that actually consumes tokens and
 *      calls Claude.
 *
 * Permission model + thin-action shape mirrors {@link generateIdeasManual}.
 */
export async function generateArticleFromIdea(
  teamId: string,
  projectId: string,
  blogId: string,
  ideaId: string,
): Promise<ActionResult<GenerateArticleFromIdeaResult>> {
  if (!ideaId) {
    return { data: null, error: "Idea id is required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "consume_team_tokens", admin);

    // Confirm the blog belongs to the project (we use the admin client
    // below which bypasses RLS).
    const { data: blog } = await admin
      .from("blogs")
      .select("id")
      .eq("id", blogId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!blog) {
      return { data: null, error: "Blog not found." };
    }

    // Phase 1: durable enqueue. Validates the idea, creates the job +
    // article placeholder. No tokens consumed yet.
    const queued = await queueGenerateArticleFromIdea({
      blogId,
      teamId,
      userId: user.id,
      ideaId,
      triggerSource: "manual",
      client: admin,
    });

    // Phase 2: start the workflow unless one is already in flight for
    // this idea. `alreadyQueued = true` means a previous click is
    // still being processed — re-firing the workflow would create a
    // ghost run that double-consumes tokens (consume is idempotent on
    // job id, but the SECOND workflow would target the SAME job, hit
    // the consume no-op, and then race the first workflow's writes).
    let workflowRunId: string | null = null;
    if (!queued.alreadyQueued) {
      try {
        const run = await start(generateArticleWorkflow, [
          {
            jobId: queued.jobId,
            articleId: queued.articleId,
            blogId,
            teamId,
            userId: user.id,
            ideaId,
            triggerSource: "manual",
          },
        ]);
        workflowRunId =
          (run as { id?: string; runId?: string }).id ??
          (run as { id?: string; runId?: string }).runId ??
          null;
      } catch (err) {
        // Best effort: if the workflow runner is unreachable we leave
        // the job in `pending` so an operator can retry by re-running
        // the workflow with the same ids. The UI shows a friendly
        // error and the user can click Generate Article again later
        // (which will hit the idempotency check and re-enqueue).
        const message =
          err instanceof Error ? err.message : "Could not start workflow.";
        return {
          data: null,
          error: `Could not start the article generation workflow: ${message}`,
        };
      }
    }

    revalidatePath(
      `/teams/${teamId}/projects/${projectId}/blogs/${blogId}/ideas`,
    );
    revalidatePath(`/teams/${teamId}/projects/${projectId}/blogs/${blogId}`);
    revalidatePath(
      `/teams/${teamId}/projects/${projectId}/blogs/${blogId}/posts/${queued.articleId}`,
    );

    return {
      data: {
        jobId: queued.jobId,
        articleId: queued.articleId,
        ideaId: queued.ideaId,
        status: queued.status,
        alreadyQueued: queued.alreadyQueued,
        workflowRunId,
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { data: null, error: err.code };
    }
    const message =
      err instanceof Error ? err.message : "Could not generate article.";
    if (message === "blog_not_found") {
      return { data: null, error: "Blog not found." };
    }
    if (message === "idea_not_found") {
      return { data: null, error: "Idea not found." };
    }
    if (message === "idea_not_approved") {
      return {
        data: null,
        error:
          "Only approved ideas can be turned into articles. Approve the idea first.",
      };
    }
    return { data: null, error: message };
  }
}

/**
 * Polled by the global active-jobs tray. Returns active + recently
 * finished `article_jobs` for blogs the signed-in user can see.
 *
 * Auth: must be signed in. Team scoping happens via the user-context
 * Supabase client + the existing `Members can view article jobs in
 * team blogs` RLS policy — no admin client involved.
 *
 * Returns `{ data: [], error: null }` for unauthenticated callers
 * rather than an error so the tray can render a no-op state on the
 * marketing pages without surfacing a scary toast.
 */
export async function getActiveTeamJobs(): Promise<
  ActionResult<ActiveArticleJobRow[]>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { data: [], error: null };

  try {
    const rows = await listActiveArticleJobsForUser(supabase);
    return { data: rows, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not load active jobs.";
    return { data: null, error: message };
  }
}
