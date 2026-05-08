"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import {
  type ArticleEditableFields,
  updateArticleFields,
} from "@/services/article-service";
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
