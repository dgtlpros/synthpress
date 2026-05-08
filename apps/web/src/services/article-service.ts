import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  Tables,
  TablesUpdate,
} from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Article CRUD helpers used by the detail page + edit action.
 *
 * Lives separate from `article-generation-service.ts` because the
 * generation flow has a tight set of orchestration concerns
 * (token consumption, multi-step jobs, Anthropic calls) that this file
 * doesn't share — these helpers are plain reads and writes.
 */

type Client = SupabaseClient<Database>;

export type ArticleRow = Tables<"articles">;

const ARTICLE_DETAIL_COLUMNS =
  "id, blog_id, article_idea_id, user_id, title, slug, excerpt, content, content_markdown, meta_description, target_keyword, author_persona, word_count, status, generated_by_model, ai_model, ai_prompt, error_message, raw_ai_response, scheduled_at, published_at, created_at, updated_at, wp_post_id, wp_post_url, featured_image_url" as const;

/**
 * Loads a single article scoped to a blog. Returns `null` when the
 * article doesn't exist or doesn't belong to the blog (the caller
 * should map that to a `notFound()`).
 */
export async function getArticleByIdForBlog(
  articleId: string,
  blogId: string,
  client?: Client,
): Promise<ArticleRow | null> {
  const supabase = client ?? createAdminClient();
  const { data, error } = await supabase
    .from("articles")
    .select(ARTICLE_DETAIL_COLUMNS)
    .eq("id", articleId)
    .eq("blog_id", blogId)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as ArticleRow | null;
}

/**
 * Editable fields the manual edit form supports. Status is NOT here —
 * status transitions go through {@link transitionArticleStatusOnEdit}
 * below so the rules ("keep ready_for_review unless failed/archived")
 * stay in one place.
 */
export interface ArticleEditableFields {
  title: string;
  slug: string | null;
  excerpt: string | null;
  metaDescription: string | null;
  targetKeyword: string | null;
  contentMarkdown: string | null;
}

export const ARTICLE_TITLE_MAX = 200;
export const ARTICLE_SLUG_MAX = 120;
export const ARTICLE_EXCERPT_MAX = 500;
export const ARTICLE_META_DESCRIPTION_MAX = 200;
export const ARTICLE_TARGET_KEYWORD_MAX = 120;
/**
 * Markdown body cap. Picked so the full article + metadata fit
 * comfortably under Postgres' default 1 GB row limit and inside the
 * Supabase request body size (a few MB). Way larger than any human
 * blog post; the AI tops out around 5–10k chars in practice.
 */
export const ARTICLE_CONTENT_MAX = 100_000;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ArticleEditValidationError =
  | "title_required"
  | "title_too_long"
  | "slug_too_long"
  | "slug_invalid"
  | "excerpt_too_long"
  | "meta_description_too_long"
  | "target_keyword_too_long"
  | "content_too_long";

/**
 * Validates the editor input. Pure function — no DB touch. Returns the
 * first failure (the form surfaces one error at a time) or null.
 */
export function validateArticleEdit(
  input: ArticleEditableFields,
): ArticleEditValidationError | null {
  const title = input.title.trim();
  if (!title) return "title_required";
  if (title.length > ARTICLE_TITLE_MAX) return "title_too_long";

  if (input.slug !== null) {
    const slug = input.slug.trim();
    if (slug.length > ARTICLE_SLUG_MAX) return "slug_too_long";
    if (slug.length > 0 && !SLUG_PATTERN.test(slug)) return "slug_invalid";
  }
  if (input.excerpt !== null && input.excerpt.length > ARTICLE_EXCERPT_MAX) {
    return "excerpt_too_long";
  }
  if (
    input.metaDescription !== null &&
    input.metaDescription.length > ARTICLE_META_DESCRIPTION_MAX
  ) {
    return "meta_description_too_long";
  }
  if (
    input.targetKeyword !== null &&
    input.targetKeyword.length > ARTICLE_TARGET_KEYWORD_MAX
  ) {
    return "target_keyword_too_long";
  }
  if (
    input.contentMarkdown !== null &&
    input.contentMarkdown.length > ARTICLE_CONTENT_MAX
  ) {
    return "content_too_long";
  }
  return null;
}

/**
 * What the new status should be after a successful edit save.
 *
 *   * `failed` and `archived` stay where they are — editing a failed
 *     article shouldn't accidentally promote it to ready, and editing
 *     an archived one shouldn't unarchive it.
 *   * Everything else moves to `ready_for_review`. That covers:
 *       - `generating` → user got impatient and edited the placeholder
 *       - `draft` → user manually drafted, then edited
 *       - `ready` (legacy) → harmonize on the canonical value
 *       - `ready_for_review` → no-op
 *       - `scheduled` / `publishing` / `published` → the user is
 *         pulling the post back to review (a future "publish" flow
 *         will offer a separate button to go back to scheduled).
 */
export function transitionArticleStatusOnEdit(
  current: Database["public"]["Enums"]["article_status"],
): Database["public"]["Enums"]["article_status"] {
  if (current === "failed" || current === "archived") return current;
  return "ready_for_review";
}

export interface UpdateArticleFieldsInput {
  articleId: string;
  blogId: string;
  fields: ArticleEditableFields;
  client?: Client;
}

/**
 * Updates the editor-supported fields on an article + applies the
 * status transition rule above. Returns the updated row.
 *
 * Does NOT touch `error_message` (a successful edit doesn't mean the
 * AI failure is "fixed"). Does NOT touch `raw_ai_response` (audit data
 * stays as-is).
 *
 * Slug uniqueness: when the caller passes a non-blank slug, we
 * pre-check against the partial unique index on
 * `(blog_id, slug) where slug is not null`. The check excludes the
 * current article so resaving the same slug is a no-op. We could rely
 * on the DB constraint alone, but the typed `slug_taken` error gives
 * the action a clean hook for "Slug is already used by another
 * article in this blog." copy.
 *
 * Throws:
 *   * `Error("article_not_found")` — no row matches `(articleId, blogId)`.
 *   * `Error("invalid_article_edit:<code>")` — validation failed; the
 *     suffix matches {@link ArticleEditValidationError}.
 *   * `Error("slug_taken")` — another article in the same blog has the
 *     same non-blank slug.
 */
export async function updateArticleFields(
  input: UpdateArticleFieldsInput,
): Promise<ArticleRow> {
  const validationError = validateArticleEdit(input.fields);
  if (validationError !== null) {
    throw new Error(`invalid_article_edit:${validationError}`);
  }

  const supabase = input.client ?? createAdminClient();

  const { data: existing, error: readErr } = await supabase
    .from("articles")
    .select("status")
    .eq("id", input.articleId)
    .eq("blog_id", input.blogId)
    .maybeSingle();

  if (readErr) throw readErr;
  if (!existing) throw new Error("article_not_found");

  const trimmedSlug =
    input.fields.slug !== null ? input.fields.slug.trim() : null;
  // Skip the conflict query when the slug is empty or null — the
  // partial unique index doesn't apply to nulls and we don't want to
  // pay a query for nothing.
  if (trimmedSlug) {
    const { data: conflict, error: slugReadErr } = await supabase
      .from("articles")
      .select("id")
      .eq("blog_id", input.blogId)
      .eq("slug", trimmedSlug)
      .neq("id", input.articleId)
      .maybeSingle();

    if (slugReadErr) throw slugReadErr;
    if (conflict) throw new Error("slug_taken");
  }

  const nextStatus = transitionArticleStatusOnEdit(
    existing.status as Database["public"]["Enums"]["article_status"],
  );

  const update: TablesUpdate<"articles"> = {
    title: input.fields.title.trim(),
    slug: trimmedSlug || null,
    excerpt: input.fields.excerpt ?? "",
    meta_description: input.fields.metaDescription ?? null,
    target_keyword: input.fields.targetKeyword?.trim() || null,
    content_markdown: input.fields.contentMarkdown ?? null,
    status: nextStatus,
  };

  const { data: updated, error: updateErr } = await supabase
    .from("articles")
    .update(update)
    .eq("id", input.articleId)
    .eq("blog_id", input.blogId)
    .select(ARTICLE_DETAIL_COLUMNS)
    .single();

  if (updateErr) throw updateErr;
  return updated as ArticleRow;
}

/**
 * Returns a `Map<ideaId, articleId>` for the article ids linked to a
 * batch of ideas. Used by the Ideas page to render "View article" links
 * on `converted_to_article` cards without N+1 queries. Pass an empty
 * array and you get an empty map — no DB call.
 *
 * Picks the most recently created article when an idea was somehow
 * generated multiple times (shouldn't happen — convert flow is the only
 * writer — but the orchestration's "create article placeholder" step
 * runs even on retries, so a failed-then-succeeded idea has one row
 * with `status='failed'` and one with `status='ready_for_review'`).
 */
export async function getArticleIdsByIdeaIds(
  ideaIds: readonly string[],
  client?: Client,
): Promise<Map<string, string>> {
  if (ideaIds.length === 0) return new Map();

  const supabase = client ?? createAdminClient();
  const { data, error } = await supabase
    .from("articles")
    .select("id, article_idea_id, status, created_at")
    .in("article_idea_id", ideaIds as string[])
    .order("created_at", { ascending: false });

  if (error) throw error;

  const result = new Map<string, string>();
  for (const row of data ?? []) {
    if (!row.article_idea_id) continue;
    // first occurrence wins → newest article per idea
    if (!result.has(row.article_idea_id)) {
      result.set(row.article_idea_id, row.id);
    }
  }
  return result;
}
