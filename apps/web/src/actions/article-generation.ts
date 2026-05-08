"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import {
  type ArticleIdeaStatus,
  generateArticleDraftFromIdea,
  type GenerateArticleDraftFromIdeaResult,
  generateArticleIdeas,
  type GenerateArticleIdeasResult,
  updateArticleIdeaStatus,
} from "@/services/article-generation-service";
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
 * The server action is intentionally thin: validate inputs, check that
 * the caller is a team member with `consume_team_tokens` permission,
 * then hand off to `generateArticleIdeas`. The orchestration function
 * is the same one the future autopilot scheduler and Vercel Workflow
 * runner will call — they'll skip this action entirely and pass their
 * own `triggerSource`.
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

export type GenerateIdeasManualResult = Pick<
  GenerateArticleIdeasResult,
  "jobId" | "creditsUsed" | "model"
> & {
  /** Number of ideas inserted into `article_ideas`. */
  ideasGenerated: number;
};

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

    // The orchestration validates the blog itself (404s as
    // `blog_not_found`) and runs against the admin client — RLS would
    // otherwise block the article_jobs / usage_events inserts.
    const result = await generateArticleIdeas({
      blogId,
      teamId,
      userId: user.id,
      brief: input.brief,
      count: input.count,
      triggerSource: "manual",
      client: admin,
    });

    revalidatePath(
      `/teams/${teamId}/projects/${projectId}/blogs/${blogId}/ideas`,
    );
    revalidatePath(`/teams/${teamId}/projects/${projectId}/blogs/${blogId}`);

    return {
      data: {
        jobId: result.jobId,
        creditsUsed: result.creditsUsed,
        model: result.model,
        ideasGenerated: result.ideas.length,
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { data: null, error: err.code };
    }
    const message =
      err instanceof Error ? err.message : "Could not generate ideas.";
    // Translate the orchestration's typed errors into friendlier UI text.
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
 * Trimmed result for the manual "Generate article from idea" action.
 * The orchestration result includes more diagnostic data (cached
 * tokens, etc.) than the UI needs.
 */
export type GenerateArticleFromIdeaResult = Pick<
  GenerateArticleDraftFromIdeaResult,
  "jobId" | "articleId" | "ideaId" | "status" | "model" | "creditsUsed"
>;

/**
 * Manual entry point for the "Generate article" button on an approved
 * idea card. Permission model + thin-action shape mirrors
 * {@link generateIdeasManual}.
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

    // Confirm the blog belongs to the project (we run the orchestration
    // through the admin client which bypasses RLS).
    const { data: blog } = await admin
      .from("blogs")
      .select("id")
      .eq("id", blogId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!blog) {
      return { data: null, error: "Blog not found." };
    }

    const result = await generateArticleDraftFromIdea({
      blogId,
      teamId,
      userId: user.id,
      ideaId,
      triggerSource: "manual",
      client: admin,
    });

    revalidatePath(
      `/teams/${teamId}/projects/${projectId}/blogs/${blogId}/ideas`,
    );
    revalidatePath(`/teams/${teamId}/projects/${projectId}/blogs/${blogId}`);

    return {
      data: {
        jobId: result.jobId,
        articleId: result.articleId,
        ideaId: result.ideaId,
        status: result.status,
        model: result.model,
        creditsUsed: result.creditsUsed,
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
    if (message === "insufficient_tokens") {
      return {
        data: null,
        error:
          "Not enough synth tokens to generate an article. Top up your balance to continue.",
      };
    }
    return { data: null, error: message };
  }
}
