import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { markdownToHtml } from "@/lib/markdown-to-html";
import type { Database, TablesUpdate } from "@/lib/supabase/database.types";

/**
 * WordPress publishing helpers used by the Article detail page.
 *
 * v1.1 surface:
 *   * {@link publishArticleToWordPressDraft} — POST /wp/v2/posts
 *     (status="draft"). Creates a fresh WP draft, stamps
 *     `wp_post_id` + `wp_post_url`. Local article status untouched.
 *   * {@link updateArticleWordPressDraft} — PUT /wp/v2/posts/{id}
 *     (status="draft"). Pushes the latest title/body/excerpt to an
 *     existing draft. Local article status untouched.
 *   * {@link publishArticleToWordPressLive} — PUT /wp/v2/posts/{id}
 *     (status="publish"). Same payload as the update flow, but
 *     transitions the WP post to live and the local article to
 *     `published` (with `published_at`).
 *
 * Connection model (still v1):
 *   The `blogs` table stores the credentials inline as
 *   `wp_url` + `wp_username` + `wp_app_password` (migrations 00001 →
 *   00014). One blog → one WordPress site. There is no separate
 *   `cms_connections` table yet — when we eventually add multi-CMS
 *   we'll split into a `publishing_connections` table.
 *
 * Why this lives in `services/` and is server-only:
 *   * It needs the application password, which never leaves the
 *     server. The `server-only` import guarantees a build-time
 *     failure if this module ever leaks into a client bundle.
 *   * The Supabase write that stamps `wp_post_id` / `wp_post_url`
 *     onto the article uses the admin (service-role) client and
 *     bypasses RLS — that's fine because the calling server action
 *     has already enforced `manage_blog`.
 *
 * Future-proofing:
 *   The three public functions are thin wrappers around
 *   {@link syncArticleToWordPress}. When we add image uploads
 *   (`POST /wp/v2/media`) or autopilot publishing, we'll either
 *   reuse the same helper (passing an extra `mode`) or add a
 *   sibling `uploadMediaToWordPress` that shares
 *   {@link buildBasicAuthHeader} + connection loading. The shared
 *   internal pieces (`loadBlogConnection`, `buildBasicAuthHeader`,
 *   the markdown→html→sanitize pipeline) are deliberately exported
 *   or kept as small testable units.
 */

type Client = SupabaseClient<Database>;

export interface BlogConnectionRow {
  wp_url: string | null;
  wp_username: string | null;
  wp_app_password: string | null;
}

export interface WordPressSyncInput {
  articleId: string;
  blogId: string;
  /**
   * Inject a `fetch` for tests. Defaults to the global. We never
   * pass third-party libraries — the WordPress REST API is plain
   * JSON over HTTPS.
   */
  fetchImpl?: typeof fetch;
  client?: Client;
}

/**
 * Possible operations the helper performs against the WP REST API.
 *   * `create_draft` — POST a new draft. Requires NO existing
 *     `wp_post_id` (we don't allow recreating a post in place).
 *   * `update_draft` — PUT an existing draft. Requires an existing
 *     `wp_post_id`. Local article status is untouched.
 *   * `publish_live` — PUT an existing draft (or live post) to
 *     `status="publish"`. Requires an existing `wp_post_id`.
 *     Transitions the local article to `published`.
 */
export type WordPressSyncMode =
  | "create_draft"
  | "update_draft"
  | "publish_live";

export interface WordPressSyncResult {
  wpPostId: number;
  wpPostUrl: string | null;
  /** WordPress-side status after the call. */
  wpStatus: "draft" | "publish";
  /** True iff the local article row was transitioned to `published`. */
  publishedLocally: boolean;
}

/** Back-compat type used by the v1 caller. */
export type PublishArticleToWordPressInput = WordPressSyncInput;
/** Back-compat type used by the v1 caller. */
export interface PublishArticleToWordPressResult {
  wpPostId: number;
  wpPostUrl: string | null;
  status: "draft";
}

/**
 * Friendly error codes the action layer maps to UI copy. Throwing a
 * tagged Error keeps the helper's return type tight while still
 * letting the caller distinguish "no connection" (configuration
 * issue) from "WordPress rejected the request" (transient / remote)
 * from "no body to publish" (local data issue).
 *
 * `wp_post_not_found` is specific to update / publish-live: we tried
 * to PUT an existing post id and WordPress returned 404. Surfaced so
 * the UI can offer a "Clear WordPress Link" affordance.
 *
 * `wp_post_id_required` is the *local* counterpart: caller asked to
 * update / publish-live but `articles.wp_post_id` is null. Different
 * code so the UI doesn't suggest "the WP post was deleted" when the
 * truth is "you never sent it in the first place".
 */
export type PublishArticleErrorCode =
  | "article_not_found"
  | "blog_not_found"
  | "no_wp_connection"
  | "empty_article_body"
  | "wp_post_id_required"
  | "wp_post_not_found"
  | "wp_request_failed"
  | "wp_invalid_response";

export class PublishArticleError extends Error {
  readonly code: PublishArticleErrorCode;
  readonly details?: string;

  constructor(code: PublishArticleErrorCode, details?: string) {
    super(`publish_article_error:${code}${details ? `:${details}` : ""}`);
    this.name = "PublishArticleError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Normalises the site URL into a `https://host/wp-json/wp/v2/posts`
 * endpoint. Trims a trailing slash so `https://example.com/` and
 * `https://example.com` both produce the same URL. Doesn't try to
 * cope with non-standard `/wp-json` mount points — those are vanishingly
 * rare and the caller can fix them upstream by passing the full
 * `/wp-json` URL in `wp_url` if needed.
 */
export function buildWordPressPostsEndpoint(
  siteUrl: string,
  wpPostId?: number,
): string {
  const trimmed = siteUrl.trim().replace(/\/+$/, "");
  const base = `${trimmed}/wp-json/wp/v2/posts`;
  return wpPostId ? `${base}/${wpPostId}` : base;
}

/**
 * Builds the `Authorization: Basic <base64>` header value WordPress
 * Application Passwords use. We strip whitespace from the password
 * because the WP UI displays it with spaces every 4 chars for
 * readability — and a fair number of users copy-paste those spaces.
 * WordPress itself strips them on the receiving side, but doing it
 * here means the over-the-wire bytes are smaller and the encoded
 * Basic value is byte-stable.
 */
export function buildBasicAuthHeader(
  username: string,
  appPassword: string,
): string {
  const cleanedPassword = appPassword.replace(/\s+/g, "");
  const token = Buffer.from(`${username}:${cleanedPassword}`).toString(
    "base64",
  );
  return `Basic ${token}`;
}

/**
 * Loads the blog row tightening the projection to just the WP
 * credential fields. Returns null when the row doesn't exist (or
 * RLS hides it from this client).
 */
async function loadBlogConnection(
  blogId: string,
  client: Client,
): Promise<BlogConnectionRow | null> {
  const { data, error } = await client
    .from("blogs")
    .select("wp_url, wp_username, wp_app_password")
    .eq("id", blogId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

interface ArticleForPublish {
  id: string;
  title: string;
  slug: string | null;
  excerpt: string;
  content_markdown: string | null;
  meta_description: string | null;
  blog_id: string;
  wp_post_id: number | null;
}

async function loadArticleForPublish(
  articleId: string,
  blogId: string,
  client: Client,
): Promise<ArticleForPublish | null> {
  const { data, error } = await client
    .from("articles")
    .select(
      "id, blog_id, title, slug, excerpt, content_markdown, meta_description, wp_post_id",
    )
    .eq("id", articleId)
    .eq("blog_id", blogId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as ArticleForPublish | null;
}

/**
 * The minimum shape of the WordPress REST `POST/PUT /wp/v2/posts`
 * 200/201 response we care about. WordPress returns dozens of fields;
 * we only read these for now.
 */
interface WordPressPostResponse {
  id: number;
  link?: string | null;
  status?: string;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

interface WordPressPayload extends Record<string, unknown> {
  title: string;
  content: string;
  status: "draft" | "publish";
  excerpt: string;
  slug?: string;
}

function buildWordPressPayload(
  article: ArticleForPublish,
  html: string,
  status: "draft" | "publish",
): WordPressPayload {
  const payload: WordPressPayload = {
    title: article.title,
    content: html,
    status,
    excerpt: article.excerpt || article.meta_description || "",
  };
  if (article.slug && article.slug.trim()) {
    payload.slug = article.slug.trim();
  }
  return payload;
}

/**
 * Performs the network call + response parsing. All three public
 * helpers share this so retry semantics, error mapping, and the
 * "is the response a sane post object" check stay in one place.
 *
 * `treatNotFoundAsRemoteMissing` flips a 404 from the generic
 * `wp_request_failed` to the specific `wp_post_not_found` code —
 * we set it for update/publish-live (where 404 means the WP post
 * was deleted) but not for create (a 404 on POST to /wp/v2/posts
 * would mean the REST root itself is missing, a config problem).
 */
async function performWordPressRequest(
  endpoint: string,
  method: "POST" | "PUT",
  payload: WordPressPayload,
  auth: string,
  fetchImpl: typeof fetch,
  treatNotFoundAsRemoteMissing: boolean,
): Promise<WordPressPostResponse> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: auth,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "network_error";
    throw new PublishArticleError("wp_request_failed", message);
  }

  if (!response.ok) {
    let body = "";
    try {
      body = (await response.text()).slice(0, 500);
    } catch {
      // The body is optional context; if it's already been consumed
      // or read fails for any other reason we just send the status.
    }
    if (treatNotFoundAsRemoteMissing && response.status === 404) {
      throw new PublishArticleError(
        "wp_post_not_found",
        `${response.status} ${response.statusText}${body ? ` ${body}` : ""}`,
      );
    }
    throw new PublishArticleError(
      "wp_request_failed",
      `${response.status} ${response.statusText}${body ? ` ${body}` : ""}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid_json";
    throw new PublishArticleError("wp_invalid_response", message);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !isPositiveInteger((parsed as { id?: unknown }).id)
  ) {
    throw new PublishArticleError(
      "wp_invalid_response",
      "missing or invalid `id`",
    );
  }
  return parsed as WordPressPostResponse;
}

/**
 * Shared core that all three public helpers funnel into. Lays out
 * the steps in one linear flow: load → validate → convert → request
 * → persist. Branching on `mode` is kept narrow so future
 * `publish_scheduled` or `update_published` modes plug in cheaply.
 */
async function syncArticleToWordPress(
  input: WordPressSyncInput & { mode: WordPressSyncMode },
): Promise<WordPressSyncResult> {
  const { mode } = input;
  const client = input.client ?? createAdminClient();
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  const article = await loadArticleForPublish(
    input.articleId,
    input.blogId,
    client,
  );
  if (!article) {
    throw new PublishArticleError("article_not_found");
  }

  const blog = await loadBlogConnection(input.blogId, client);
  if (!blog) {
    throw new PublishArticleError("blog_not_found");
  }

  const wpUrl = blog.wp_url?.trim();
  const wpUsername = blog.wp_username?.trim();
  const wpAppPassword = blog.wp_app_password ?? "";
  if (!wpUrl || !wpUsername || !wpAppPassword) {
    throw new PublishArticleError("no_wp_connection");
  }

  if (!article.content_markdown || !article.content_markdown.trim()) {
    throw new PublishArticleError("empty_article_body");
  }

  // Update / publish-live require an already-stamped wp_post_id.
  // Create-draft requires the absence isn't a hard constraint here —
  // the action layer disables the button when one exists, and the
  // helper still gracefully creates a fresh draft (the old WP post
  // becomes orphaned, which is what "Clear WordPress Link" + Send
  // is supposed to do).
  const requiresExistingPost =
    mode === "update_draft" || mode === "publish_live";
  if (requiresExistingPost && article.wp_post_id === null) {
    throw new PublishArticleError("wp_post_id_required");
  }

  const html = await markdownToHtml(article.content_markdown);
  if (!html.trim()) {
    // Sanitizer ate every byte (e.g. body was nothing but `<script>`
    // tags). Treat it the same as an empty body — we won't push a
    // blank draft to a remote site.
    throw new PublishArticleError("empty_article_body");
  }

  const wpStatus: "draft" | "publish" =
    mode === "publish_live" ? "publish" : "draft";
  const payload = buildWordPressPayload(article, html, wpStatus);

  const method: "POST" | "PUT" = mode === "create_draft" ? "POST" : "PUT";
  // `requiresExistingPost === true` ⇒ `wp_post_id` is non-null
  // (we already threw `wp_post_id_required` above), so the cast
  // is safe. We only pass `undefined` for the create-draft path
  // where the endpoint shouldn't include a post id.
  const endpoint = buildWordPressPostsEndpoint(
    wpUrl,
    requiresExistingPost ? (article.wp_post_id as number) : undefined,
  );
  const auth = buildBasicAuthHeader(wpUsername, wpAppPassword);

  const wpResponse = await performWordPressRequest(
    endpoint,
    method,
    payload,
    auth,
    fetchImpl,
    requiresExistingPost,
  );

  const wpPostUrl =
    typeof wpResponse.link === "string" && wpResponse.link
      ? wpResponse.link
      : null;

  // Build the local article patch. Three rules:
  //   1. Always refresh `wp_post_url` from the response (the link
  //      can change if the WP user renamed the slug remotely).
  //   2. Only touch `wp_post_id` on create — update/publish-live
  //      keep the existing one.
  //   3. publish_live transitions the local row to `published` and
  //      stamps `published_at` (only on the FIRST publish; we don't
  //      want to overwrite the original publish timestamp on every
  //      subsequent "Update Live Post" click).
  const update: TablesUpdate<"articles"> = {
    wp_post_url: wpPostUrl,
  };
  if (mode === "create_draft") {
    update.wp_post_id = wpResponse.id;
  }
  let publishedLocally = false;
  if (mode === "publish_live") {
    update.status = "published";
    publishedLocally = true;
    // Only the first publish sets published_at — subsequent
    // re-publishes (Update Live Post) preserve the original
    // publication time so analytics / sitemaps stay stable.
    const { data: existing } = await client
      .from("articles")
      .select("published_at")
      .eq("id", input.articleId)
      .eq("blog_id", input.blogId)
      .maybeSingle();
    if (!existing?.published_at) {
      update.published_at = new Date().toISOString();
    }
  }

  const { error: updateErr } = await client
    .from("articles")
    .update(update)
    .eq("id", input.articleId)
    .eq("blog_id", input.blogId);
  if (updateErr) throw updateErr;

  return {
    wpPostId: wpResponse.id,
    wpPostUrl,
    wpStatus,
    publishedLocally,
  };
}

/**
 * Sends one article to WordPress as a fresh draft. Idempotent only
 * at the "did the network call succeed" boundary — calling this
 * twice in a row will create two WP drafts. The UI guards against
 * that by disabling the button once `wp_post_id` is set.
 *
 * Throws `PublishArticleError` with one of the typed codes; the
 * caller's server action translates those into UI copy.
 */
export async function publishArticleToWordPressDraft(
  input: PublishArticleToWordPressInput,
): Promise<PublishArticleToWordPressResult> {
  const result = await syncArticleToWordPress({
    ...input,
    mode: "create_draft",
  });
  return {
    wpPostId: result.wpPostId,
    wpPostUrl: result.wpPostUrl,
    status: "draft",
  };
}

/**
 * PUTs the latest title / body / excerpt of the article to the
 * existing WordPress draft. Requires `articles.wp_post_id` to be
 * set — otherwise throws `wp_post_id_required`. A 404 from
 * WordPress maps to `wp_post_not_found` so the UI can offer the
 * "Clear WordPress Link" affordance.
 *
 * Local article status is intentionally NOT changed; the user
 * chose "Update Draft" precisely because they want to keep
 * iterating before going live.
 */
export async function updateArticleWordPressDraft(
  input: WordPressSyncInput,
): Promise<WordPressSyncResult> {
  return syncArticleToWordPress({ ...input, mode: "update_draft" });
}

/**
 * PUTs the article to WordPress with `status="publish"`. Same
 * requirements as the update flow (wp_post_id must exist; 404
 * surfaces `wp_post_not_found`). On success the local article
 * transitions to `published` and gets `published_at` stamped (on
 * the first publish only — re-publishes preserve the original).
 */
export async function publishArticleToWordPressLive(
  input: WordPressSyncInput,
): Promise<WordPressSyncResult> {
  return syncArticleToWordPress({ ...input, mode: "publish_live" });
}

/**
 * Clears the local `wp_post_id` + `wp_post_url` on the article so
 * the user can re-send as a fresh draft. Used after a
 * `wp_post_not_found` error (the WP post was deleted in the
 * WordPress admin). Does NOT touch the article's status — if the
 * row was previously `published`, the caller may want to move it
 * back to `ready_for_review` separately, but the typical path is
 * "delete remote draft → clear link → re-send" before the article
 * was ever marked published.
 */
export async function clearWordPressLink(input: {
  articleId: string;
  blogId: string;
  client?: Client;
}): Promise<void> {
  const client = input.client ?? createAdminClient();
  const { error } = await client
    .from("articles")
    .update({ wp_post_id: null, wp_post_url: null })
    .eq("id", input.articleId)
    .eq("blog_id", input.blogId);
  if (error) throw error;
}
