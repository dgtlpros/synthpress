"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import {
  type ArticleEditableFields,
  updateArticleFields,
} from "@/services/article-service";
import {
  clearWordPressLink,
  PublishArticleError,
  publishArticleToWordPressDraft,
  publishArticleToWordPressLive,
  type WordPressSyncResult,
  updateArticleWordPressDraft,
} from "@/services/wordpress-publish-service";
import { PUBLISH_ARTICLE_ERROR_COPY } from "@/lib/wordpress-publish-error-copy";
import type { Database } from "@/lib/supabase/database.types";
import type { ActionResult } from "./workspace";

/**
 * Manual edit/save flow for the article detail page.
 *
 * Mirrors the shape of the other domain actions in this folder:
 * thin wrapper around a service helper, all auth + permission +
 * ownership checks live here, and we translate the service's typed
 * errors into UI copy.
 */

export type UpdateArticleStatus = Database["public"]["Enums"]["article_status"];

export interface UpdateArticleResult {
  articleId: string;
  status: UpdateArticleStatus;
}

/**
 * Maps the validation codes from the service into one-line UI copy.
 * Kept as a function so the action stays a flat sequence of guards.
 */
function translateValidationCode(code: string): string {
  switch (code) {
    case "title_required":
      return "Title is required.";
    case "title_too_long":
      return "Title is too long.";
    case "slug_too_long":
      return "Slug is too long.";
    case "slug_invalid":
      return "Slug must be lowercase letters, numbers, and hyphens only.";
    case "excerpt_too_long":
      return "Excerpt is too long.";
    case "meta_description_too_long":
      return "Meta description is too long.";
    case "target_keyword_too_long":
      return "Target keyword is too long.";
    case "content_too_long":
      return "Article body is too long.";
    /* v8 ignore next 2 -- defensive: code list is closed by the service union */
    default:
      return "Invalid article fields.";
  }
}

export async function updateArticle(
  teamId: string,
  projectId: string,
  blogId: string,
  articleId: string,
  fields: ArticleEditableFields,
): Promise<ActionResult<UpdateArticleResult>> {
  if (!articleId) {
    return { data: null, error: "Article id is required." };
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

    // Confirm the blog belongs to the project (RLS would block a
    // mismatched read on the user's own client, but we run the update
    // through the admin client so we have to enforce the chain here).
    const { data: blog } = await admin
      .from("blogs")
      .select("id")
      .eq("id", blogId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!blog) {
      return { data: null, error: "Blog not found." };
    }

    const updated = await updateArticleFields({
      articleId,
      blogId,
      fields,
      client: admin,
    });

    revalidatePath(
      `/teams/${teamId}/projects/${projectId}/blogs/${blogId}/posts/${articleId}`,
    );
    revalidatePath(`/teams/${teamId}/projects/${projectId}/blogs/${blogId}`);

    return {
      data: {
        articleId: updated.id,
        status: updated.status as UpdateArticleStatus,
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { data: null, error: err.code };
    }
    const message =
      err instanceof Error ? err.message : "Could not save article.";
    if (message === "article_not_found") {
      return { data: null, error: "Article not found." };
    }
    if (message === "slug_taken") {
      return {
        data: null,
        error: "Slug is already used by another article in this blog.",
      };
    }
    if (message.startsWith("invalid_article_edit:")) {
      const code = message.slice("invalid_article_edit:".length);
      return { data: null, error: translateValidationCode(code) };
    }
    return { data: null, error: message };
  }
}

/**
 * Manual WordPress publishing flow for the article detail page.
 *
 * v1.1 surface:
 *   * {@link sendArticleToWordPressDraft}    — POST  /wp/v2/posts        (status="draft")
 *   * {@link updateArticleWordPressDraftAction} — PUT /wp/v2/posts/{id}  (status="draft")
 *   * {@link publishArticleToWordPressLiveAction} — PUT /wp/v2/posts/{id} (status="publish")
 *   * {@link clearArticleWordPressLink}      — local-only: nulls wp_post_id/url
 *
 * All four mirror {@link updateArticle}'s shape: auth + manage_blog +
 * blog-belongs-to-project checks live here, then delegate to the
 * service. Typed `PublishArticleError`s are mapped to UI copy via
 * {@link PUBLISH_ARTICLE_ERROR_COPY}.
 */
export interface SendArticleToWordPressResult {
  articleId: string;
  wpPostId: number;
  wpPostUrl: string | null;
}

/**
 * Result of the update / publish-live actions. Carries enough for
 * the hook to render the success state without waiting on
 * `router.refresh()` to round-trip Supabase. `wpStatus` mirrors the
 * value WP now holds; `publishedLocally` is true iff the action also
 * transitioned the local article to `published`.
 */
export interface SyncArticleToWordPressResult {
  articleId: string;
  wpPostId: number;
  wpPostUrl: string | null;
  wpStatus: "draft" | "publish";
  publishedLocally: boolean;
}

/**
 * Shared auth + ownership preamble for every WP action below. Returns
 * either a usable admin client (auth + permission + blog-in-project
 * all checked) OR a typed error result the caller can return as-is.
 */
async function preflightForWordPressAction(
  teamId: string,
  projectId: string,
  blogId: string,
  articleId: string,
): Promise<
  | { ok: true; admin: ReturnType<typeof createAdminClient> }
  | { ok: false; result: ActionResult<never> }
> {
  if (!articleId) {
    return {
      ok: false,
      result: { data: null, error: "Article id is required." },
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      result: { data: null, error: "You must be signed in." },
    };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "manage_blog", admin);

    const { data: blog } = await admin
      .from("blogs")
      .select("id")
      .eq("id", blogId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!blog) {
      return {
        ok: false,
        result: { data: null, error: "Blog not found." },
      };
    }

    return { ok: true, admin };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { ok: false, result: { data: null, error: err.code } };
    }
    const message =
      err instanceof Error ? err.message : "WordPress action failed.";
    return { ok: false, result: { data: null, error: message } };
  }
}

/** Maps `PublishArticleError` and other thrown values to a UI-ready string. */
function translatePublishError(err: unknown, fallback: string): string {
  if (err instanceof PublishArticleError) {
    return PUBLISH_ARTICLE_ERROR_COPY[err.code];
  }
  return err instanceof Error ? err.message : fallback;
}

function revalidateWordPressPaths(
  teamId: string,
  projectId: string,
  blogId: string,
  articleId: string,
): void {
  revalidatePath(
    `/teams/${teamId}/projects/${projectId}/blogs/${blogId}/posts/${articleId}`,
  );
  revalidatePath(`/teams/${teamId}/projects/${projectId}/blogs/${blogId}`);
}

function toSyncResult(
  articleId: string,
  result: WordPressSyncResult,
): SyncArticleToWordPressResult {
  return {
    articleId,
    wpPostId: result.wpPostId,
    wpPostUrl: result.wpPostUrl,
    wpStatus: result.wpStatus,
    publishedLocally: result.publishedLocally,
  };
}

export async function sendArticleToWordPressDraft(
  teamId: string,
  projectId: string,
  blogId: string,
  articleId: string,
): Promise<ActionResult<SendArticleToWordPressResult>> {
  const pre = await preflightForWordPressAction(
    teamId,
    projectId,
    blogId,
    articleId,
  );
  if (!pre.ok) return pre.result;

  try {
    const result = await publishArticleToWordPressDraft({
      articleId,
      blogId,
      client: pre.admin,
    });
    revalidateWordPressPaths(teamId, projectId, blogId, articleId);
    return {
      data: {
        articleId,
        wpPostId: result.wpPostId,
        wpPostUrl: result.wpPostUrl,
      },
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: translatePublishError(err, "Could not send article to WordPress."),
    };
  }
}

export async function updateArticleWordPressDraftAction(
  teamId: string,
  projectId: string,
  blogId: string,
  articleId: string,
): Promise<ActionResult<SyncArticleToWordPressResult>> {
  const pre = await preflightForWordPressAction(
    teamId,
    projectId,
    blogId,
    articleId,
  );
  if (!pre.ok) return pre.result;

  try {
    const result = await updateArticleWordPressDraft({
      articleId,
      blogId,
      client: pre.admin,
    });
    revalidateWordPressPaths(teamId, projectId, blogId, articleId);
    return { data: toSyncResult(articleId, result), error: null };
  } catch (err) {
    return {
      data: null,
      error: translatePublishError(err, "Could not update WordPress draft."),
    };
  }
}

export async function publishArticleToWordPressLiveAction(
  teamId: string,
  projectId: string,
  blogId: string,
  articleId: string,
): Promise<ActionResult<SyncArticleToWordPressResult>> {
  const pre = await preflightForWordPressAction(
    teamId,
    projectId,
    blogId,
    articleId,
  );
  if (!pre.ok) return pre.result;

  try {
    const result = await publishArticleToWordPressLive({
      articleId,
      blogId,
      client: pre.admin,
    });
    revalidateWordPressPaths(teamId, projectId, blogId, articleId);
    return { data: toSyncResult(articleId, result), error: null };
  } catch (err) {
    return {
      data: null,
      error: translatePublishError(
        err,
        "Could not publish article live to WordPress.",
      ),
    };
  }
}

export interface ClearArticleWordPressLinkResult {
  articleId: string;
}

export async function clearArticleWordPressLink(
  teamId: string,
  projectId: string,
  blogId: string,
  articleId: string,
): Promise<ActionResult<ClearArticleWordPressLinkResult>> {
  const pre = await preflightForWordPressAction(
    teamId,
    projectId,
    blogId,
    articleId,
  );
  if (!pre.ok) return pre.result;

  try {
    await clearWordPressLink({ articleId, blogId, client: pre.admin });
    revalidateWordPressPaths(teamId, projectId, blogId, articleId);
    return { data: { articleId }, error: null };
  } catch (err) {
    return {
      data: null,
      error:
        err instanceof Error ? err.message : "Could not clear WordPress link.",
    };
  }
}
