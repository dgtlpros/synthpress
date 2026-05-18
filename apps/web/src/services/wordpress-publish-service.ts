import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildFeaturedImageFilename } from "@/lib/build-featured-image-filename";
import { markdownToHtml } from "@/lib/markdown-to-html";
import type { Database, TablesUpdate } from "@/lib/supabase/database.types";
import {
  getActiveImageUploadForArticle,
  listSectionImageRowsForArticle,
  stampWordPressMediaIdOnImageUpload,
  type ArticleImageUploadRow,
} from "./article-image-upload-service";
import { getImageProvider } from "./image-providers/registry";
import { ImageSearchError } from "./image-providers/types";
import { extractArticleSections } from "@/lib/extract-article-sections";
import type {
  SectionImageForHtml,
} from "@/lib/markdown-to-html";

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
  | "wp_invalid_response"
  /** Featured-image fetch from `featured_image_url` failed (network / non-2xx). */
  | "image_fetch_failed"
  /** The fetched featured image had a non-image Content-Type. */
  | "image_invalid_content_type"
  /** WordPress rejected the `POST /wp/v2/media` upload. */
  | "wp_media_upload_failed"
  /** WordPress returned a 200 but a payload missing `id`. */
  | "wp_invalid_media_response"
  /**
   * Same four classes as the featured-image codes above, but raised
   * from the section-image upload path. Kept distinct so the
   * friendly UI copy can say "a section image" instead of "the
   * featured image" — the failure surface is the same shape but the
   * recovery action differs (user can clear the bad slot from the
   * editor + re-publish).
   */
  | "section_image_fetch_failed"
  | "section_image_invalid_content_type"
  | "section_image_upload_failed"
  | "section_image_invalid_response";

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
 * Same shape as {@link buildWordPressPostsEndpoint} but for the
 * media (`/wp-json/wp/v2/media`) endpoint. Pass an `id` for the
 * single-resource path (used by the alt-text PUT after upload).
 */
export function buildWordPressMediaEndpoint(
  siteUrl: string,
  mediaId?: number,
): string {
  const trimmed = siteUrl.trim().replace(/\/+$/, "");
  const base = `${trimmed}/wp-json/wp/v2/media`;
  return mediaId ? `${base}/${mediaId}` : base;
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
  /** Used (alongside title + alt) to build SEO-friendly upload filenames. */
  target_keyword: string | null;
  blog_id: string;
  wp_post_id: number | null;
  featured_image_url: string | null;
  featured_image_alt: string | null;
  wp_featured_media_id: number | null;
}

async function loadArticleForPublish(
  articleId: string,
  blogId: string,
  client: Client,
): Promise<ArticleForPublish | null> {
  const { data, error } = await client
    .from("articles")
    .select(
      "id, blog_id, title, slug, excerpt, content_markdown, meta_description, target_keyword, wp_post_id, featured_image_url, featured_image_alt, wp_featured_media_id",
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
  /**
   * WordPress attachment id of the featured image. Only set when the
   * article has a `wp_featured_media_id` (cached from a previous
   * upload, or freshly uploaded by `ensureFeaturedMediaUploaded`).
   * WordPress accepts `0` as "no featured image" but we omit the key
   * entirely when no image is configured so we don't accidentally
   * blow away a remote-set featured image on update.
   */
  featured_media?: number;
}

function buildWordPressPayload(
  article: ArticleForPublish,
  html: string,
  status: "draft" | "publish",
  featuredMediaId: number | null,
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
  if (featuredMediaId !== null) {
    payload.featured_media = featuredMediaId;
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

  const auth = buildBasicAuthHeader(wpUsername, wpAppPassword);

  // Lazy featured-image upload. Three cases:
  //   * No featured image URL → skip; payload omits `featured_media`.
  //   * Featured image URL + cached `wp_featured_media_id` → reuse the
  //     existing attachment id. NO upload, NO bytes over the wire.
  //   * Featured image URL but no cached id → upload now via
  //     `POST /wp/v2/media`, stamp `wp_featured_media_id` on the row,
  //     then include the new id in the post payload.
  // The upload call may throw image-related PublishArticleErrors
  // (image_fetch_failed, image_invalid_content_type,
  // wp_media_upload_failed, wp_invalid_media_response) — we let
  // them propagate so the caller's UI surfaces the friendly copy.
  const featuredMediaId = await ensureFeaturedMediaUploaded({
    article,
    wpUrl,
    auth,
    fetchImpl,
    client,
  });

  // Section-image upload. Three steps:
  //   1. Load every `article_image_uploads` row with
  //      `role = 'section'` for this article.
  //   2. Drop orphan rows whose `section_key` is no longer in the
  //      saved body (parser is the source of truth for "what
  //      section keys exist now"). Orphans MUST NOT be uploaded —
  //      shipping a published post with images that can't be
  //      injected anywhere would burn WordPress media slots.
  //   3. For each surviving row, reuse the cached `wp_media_id` or
  //      upload now. Failures throw a section-prefixed
  //      `PublishArticleError` so the UI says "a section image" in
  //      the friendly copy. Stamping + provider download tracking
  //      are best-effort and don't fail the publish.
  // The resulting `sectionImagesByKey` map is handed to
  // `markdownToHtml` so the injector renders a `<figure>` above
  // each matching H2 in the published HTML.
  const allSectionRows = await listSectionImageRowsForArticle(
    article.id,
    client,
  );
  const savedSectionKeys = new Set(
    extractArticleSections(article.content_markdown).map((s) => s.sectionKey),
  );
  const liveSectionRows = allSectionRows.filter(
    (row) => row.section_key && savedSectionKeys.has(row.section_key),
  );
  const sectionUploadResults = await ensureSectionMediaUploaded({
    article,
    sectionRows: liveSectionRows,
    wpUrl,
    auth,
    fetchImpl,
    client,
  });
  const sectionImagesByKey = buildSectionImagesByKey(sectionUploadResults);

  const html = await markdownToHtml(article.content_markdown, {
    sectionImagesByKey,
  });
  if (!html.trim()) {
    // Sanitizer ate every byte (e.g. body was nothing but `<script>`
    // tags). Treat it the same as an empty body — we won't push a
    // blank draft to a remote site.
    throw new PublishArticleError("empty_article_body");
  }

  const wpStatus: "draft" | "publish" =
    mode === "publish_live" ? "publish" : "draft";
  const payload = buildWordPressPayload(
    article,
    html,
    wpStatus,
    featuredMediaId,
  );

  const method: "POST" | "PUT" = mode === "create_draft" ? "POST" : "PUT";
  // `requiresExistingPost === true` ⇒ `wp_post_id` is non-null
  // (we already threw `wp_post_id_required` above), so the cast
  // is safe. We only pass `undefined` for the create-draft path
  // where the endpoint shouldn't include a post id.
  const endpoint = buildWordPressPostsEndpoint(
    wpUrl,
    requiresExistingPost ? (article.wp_post_id as number) : undefined,
  );

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

// ============================================================================
// Featured-image upload (POST/PUT /wp/v2/media)
// ============================================================================

export interface UploadMediaToWordPressInput {
  blogId: string;
  /**
   * Public URL of the source image. Fetched server-side, validated
   * as an `image/*` content-type, then streamed to WordPress.
   */
  imageUrl: string;
  /** Accessible alt text. Optional; persisted on the WP media row if provided. */
  altText?: string | null;
  /**
   * Filename WordPress sees in the `Content-Disposition` header.
   * Defaults to the last path segment of `imageUrl`, or
   * `featured-image` if we can't infer one.
   */
  filename?: string;
  fetchImpl?: typeof fetch;
  client?: Client;
}

export interface UploadMediaToWordPressResult {
  mediaId: number;
  /** Public URL of the uploaded media (`source_url`). May be null. */
  sourceUrl: string | null;
  /** Echo of the alt text we tried to set (may have been null). */
  altText: string | null;
}

/**
 * Minimum shape of the WordPress REST `POST /wp/v2/media` 201 we
 * care about. WordPress returns dozens of fields; we only read
 * these.
 */
interface WordPressMediaResponse {
  id: number;
  source_url?: string | null;
  alt_text?: string | null;
}

/**
 * Public helper: fetches an image by URL, validates it's an image,
 * and uploads it to WordPress as a media attachment. Optionally
 * sets `alt_text` via a follow-up PUT (WordPress doesn't accept
 * alt text on the original `multipart/form-data` POST in older WP
 * versions — the safe path is upload → patch).
 *
 * Used by:
 *   * `syncArticleToWordPress` (lazy upload during publish/update)
 *   * Future autopilot publishing
 *   * Future inline-image uploads (with a different filename/path)
 *
 * Does NOT touch `articles.wp_featured_media_id` — the caller
 * decides whether to cache the result. Keeps this helper reusable
 * for non-featured uploads later.
 */
export async function uploadMediaToWordPress(
  input: UploadMediaToWordPressInput,
): Promise<UploadMediaToWordPressResult> {
  const client = input.client ?? createAdminClient();
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

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
  const auth = buildBasicAuthHeader(wpUsername, wpAppPassword);

  return uploadMediaToWordPressWithAuth({
    wpUrl,
    auth,
    imageUrl: input.imageUrl,
    altText: input.altText ?? null,
    filename: input.filename,
    fetchImpl,
  });
}

interface UploadMediaWithAuthInput {
  wpUrl: string;
  auth: string;
  imageUrl: string;
  altText: string | null;
  /** Explicit filename override; wins over `filenameContext` when set. */
  filename?: string;
  /**
   * SEO-friendly filename hints used when no explicit `filename` is
   * provided. We can only build the filename AFTER we've fetched the
   * image (we need the actual content-type to pick the extension), so
   * the publish path passes its source-of-truth fields here and the
   * inner uploader runs `buildFeaturedImageFilename` with them.
   */
  filenameContext?: {
    articleTitle?: string | null;
    targetKeyword?: string | null;
    featuredImageAlt?: string | null;
  };
  fetchImpl: typeof fetch;
}

/**
 * The shared upload path used by both the public helper and the
 * publish flow's lazy uploader. Skips the connection lookup since
 * the publish path already has it loaded.
 */
async function uploadMediaToWordPressWithAuth(
  input: UploadMediaWithAuthInput,
): Promise<UploadMediaToWordPressResult> {
  // 1. Fetch the source image. Network errors and non-2xx responses
  // both map to image_fetch_failed — the user gets one friendly
  // message either way ("we couldn't reach the image URL").
  let imageRes: Response;
  try {
    imageRes = await input.fetchImpl(input.imageUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "network_error";
    throw new PublishArticleError("image_fetch_failed", message);
  }
  if (!imageRes.ok) {
    throw new PublishArticleError(
      "image_fetch_failed",
      `${imageRes.status} ${imageRes.statusText}`,
    );
  }

  const contentType = imageRes.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) {
    throw new PublishArticleError(
      "image_invalid_content_type",
      contentType || "missing",
    );
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await imageRes.arrayBuffer();
    /* v8 ignore start -- defensive: arrayBuffer() rarely throws after a successful fetch */
  } catch (err) {
    const message = err instanceof Error ? err.message : "arraybuffer_failed";
    throw new PublishArticleError("image_fetch_failed", message);
  }
  /* v8 ignore stop */

  // Filename priority:
  //   1. Caller-supplied `filename` (e.g. an explicit override from
  //      the public `uploadMediaToWordPress` API).
  //   2. SEO-friendly filename built from the article context + the
  //      content-type we just learned from the fetch.
  //   3. Old URL-derived filename (kept as a fallback for callers
  //      that don't pass any context — e.g. future inline-image
  //      uploads where the article-level fields don't apply).
  let filename: string;
  if (input.filename) {
    filename = input.filename;
  } else if (input.filenameContext) {
    filename = buildFeaturedImageFilename({
      articleTitle: input.filenameContext.articleTitle,
      targetKeyword: input.filenameContext.targetKeyword,
      featuredImageAlt: input.filenameContext.featuredImageAlt,
      contentType,
    });
  } else {
    filename = deriveFilename(input.imageUrl, contentType);
  }

  // 2. POST to /wp/v2/media. We send the raw bytes (NOT
  // multipart/form-data) — WordPress accepts either, and raw bytes
  // give us byte-stable Content-Length without a multipart boundary
  // dance in Node's fetch.
  const mediaEndpoint = buildWordPressMediaEndpoint(input.wpUrl);
  let uploadRes: Response;
  try {
    uploadRes = await input.fetchImpl(mediaEndpoint, {
      method: "POST",
      headers: {
        Authorization: input.auth,
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
        Accept: "application/json",
      },
      body: bytes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "network_error";
    throw new PublishArticleError("wp_media_upload_failed", message);
  }

  if (!uploadRes.ok) {
    let body = "";
    try {
      body = (await uploadRes.text()).slice(0, 500);
    } catch {
      // Body is optional context.
    }
    throw new PublishArticleError(
      "wp_media_upload_failed",
      `${uploadRes.status} ${uploadRes.statusText}${body ? ` ${body}` : ""}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = await uploadRes.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid_json";
    throw new PublishArticleError("wp_invalid_media_response", message);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !isPositiveInteger((parsed as { id?: unknown }).id)
  ) {
    throw new PublishArticleError(
      "wp_invalid_media_response",
      "missing or invalid `id`",
    );
  }
  const mediaResponse = parsed as WordPressMediaResponse;
  const sourceUrl =
    typeof mediaResponse.source_url === "string" && mediaResponse.source_url
      ? mediaResponse.source_url
      : null;

  // 3. Optionally PUT the alt text. We do this even if WP echoed
  // `alt_text` back from the original POST — older WP versions
  // ignore alt_text on multipart/raw uploads, so a follow-up PUT
  // is the safe path. Failures here are non-fatal — alt text is a
  // nice-to-have, the upload itself succeeded.
  const trimmedAlt = input.altText?.trim() || null;
  if (trimmedAlt && mediaResponse.alt_text !== trimmedAlt) {
    try {
      await input.fetchImpl(
        buildWordPressMediaEndpoint(input.wpUrl, mediaResponse.id),
        {
          method: "PUT",
          headers: {
            Authorization: input.auth,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ alt_text: trimmedAlt }),
        },
      );
      /* v8 ignore start -- defensive: alt-text patch is best-effort */
    } catch {
      // Swallow — the media upload itself succeeded; the alt text
      // can be fixed by an operator later via the WP admin.
    }
    /* v8 ignore stop */
  }

  return {
    mediaId: mediaResponse.id,
    sourceUrl,
    altText: trimmedAlt,
  };
}

/**
 * Internal helper used by `syncArticleToWordPress`. Returns the
 * `featured_media` value to embed in the post payload (or `null`
 * for "no featured image"). Caches the new id on `articles` when
 * we just uploaded.
 */
async function ensureFeaturedMediaUploaded(opts: {
  article: ArticleForPublish;
  wpUrl: string;
  auth: string;
  fetchImpl: typeof fetch;
  client: Client;
}): Promise<number | null> {
  const { article, wpUrl, auth, fetchImpl, client } = opts;
  const imageUrl = article.featured_image_url?.trim();
  if (!imageUrl) return null;
  if (article.wp_featured_media_id) {
    // Already uploaded; reuse the cached attachment id.
    return article.wp_featured_media_id;
  }

  const result = await uploadMediaToWordPressWithAuth({
    wpUrl,
    auth,
    imageUrl,
    altText: article.featured_image_alt,
    // Pass the article fields so the uploader can build an
    // SEO-friendly `Content-Disposition` filename once it's read the
    // source content-type. We don't precompute the filename here
    // because the extension depends on the WP-side content type
    // (e.g. an Unsplash URL with no extension might serve `image/jpeg`
    // OR `image/webp` depending on Accept negotiation).
    filenameContext: {
      articleTitle: article.title,
      targetKeyword: article.target_keyword,
      featuredImageAlt: article.featured_image_alt,
    },
    fetchImpl,
  });

  // Stamp the cached attachment id on the row so subsequent
  // updates / re-publishes don't re-upload the same bytes. Failure
  // here means the next sync will upload a duplicate — annoying
  // but not user-facing — so we don't bubble it.
  /* v8 ignore start -- defensive: caching write failure is best-effort */
  const { error } = await client
    .from("articles")
    .update({ wp_featured_media_id: result.mediaId })
    .eq("id", article.id)
    .eq("blog_id", article.blog_id);
  if (error) {
    // Swallow — operator can reconcile by checking the WP media
    // library; the post payload still picks up the freshly-returned id.
  }
  /* v8 ignore stop */

  // Post-upload Unsplash bookkeeping. Look up the active
  // attribution row for this article + image — only present when
  // the user picked from the Unsplash / recently-used picker (a
  // manually-pasted URL has no row). Two best-effort follow-ups:
  //
  //   1. Fire the Unsplash `download_location` GET so the
  //      photographer's stats reflect this download. Required by
  //      Unsplash's API guidelines for any "actual use" of a photo.
  //      We only do this once per upload — the cached
  //      `wp_featured_media_id` early-return at the top guarantees
  //      we never re-trigger for the same image.
  //
  //   2. Stamp `article_image_uploads.wp_media_id` so the row
  //      reflects the WP-side id. Future "Recently used" picks of
  //      this same image get the cached id without re-uploading.
  //
  // Both are wrapped in try/catch and swallow because the WP
  // article publish above us already succeeded — failing the
  // publish over an attribution bookkeeping miss would be the
  // wrong trade-off.
  await runPostUploadBookkeeping({
    article,
    wpMediaId: result.mediaId,
    fetchImpl,
    client,
  });

  return result.mediaId;
}

/**
 * Result row produced by {@link ensureSectionMediaUploaded}. Carries
 * everything the HTML injector needs to build the `<figure>` block:
 * the (WP-side or original) image URL, alt text, the `wp_media_id`
 * for the `wp-image-{id}` class, and the provider attribution map
 * keyed by `section_key`.
 */
interface SectionUploadResult {
  sectionKey: string;
  wpMediaId: number;
  /** WP `source_url` from the upload response. Falls back to the original `image_url`. */
  imageUrl: string;
  altText: string | null;
  provider: string;
  photographerName: string | null;
  photographerProfileUrl: string | null;
  photoUrl: string | null;
  downloadLocation: string | null;
}

/**
 * Maps a WordPress media upload's `PublishArticleError` codes to
 * the section-image equivalents. Same shape as the featured-image
 * errors, but the friendly copy says "section image" and points
 * the user at the section-image editor (not the featured-image
 * card) for recovery.
 *
 * Kept as a function so future codes (and the matching `details`
 * passthrough) stay in one place.
 */
function toSectionImageError(err: unknown): PublishArticleError {
  // `uploadMediaToWordPressWithAuth` only ever throws
  // `PublishArticleError` (see its body — every throw site uses
  // `throw new PublishArticleError(...)`). Anything else here would
  // be a future regression — we rethrow it as-is rather than
  // pretending it's a section-image failure.
  /* v8 ignore next 1 -- defensive: the underlying uploader's contract guarantees PublishArticleError */
  if (!(err instanceof PublishArticleError)) throw err;
  switch (err.code) {
    case "image_fetch_failed":
      return new PublishArticleError(
        "section_image_fetch_failed",
        err.details,
      );
    case "image_invalid_content_type":
      return new PublishArticleError(
        "section_image_invalid_content_type",
        err.details,
      );
    case "wp_media_upload_failed":
      return new PublishArticleError(
        "section_image_upload_failed",
        err.details,
      );
    case "wp_invalid_media_response":
      return new PublishArticleError(
        "section_image_invalid_response",
        err.details,
      );
    /* v8 ignore next 5 -- defensive: the four codes above are the only ones the uploader emits today; the default keeps a future new code from leaking the featured-image copy through to the section-image surface */
    default:
      return new PublishArticleError(
        "section_image_upload_failed",
        err.details,
      );
  }
}

/**
 * Internal helper used by `syncArticleToWordPress`. For each
 * supplied section image row:
 *
 *   * If `wp_media_id` is already set, reuse it — no upload, no
 *     bytes over the wire, no download tracking ping (which already
 *     fired the first time the row was uploaded).
 *   * Otherwise, upload the row's `image_url` to WordPress via
 *     `uploadMediaToWordPressWithAuth`, stamp `wp_media_id` back on
 *     the row, fire the provider's `trackDownload` so the
 *     photographer's stats reflect this use, and return the new
 *     id + `source_url`.
 *
 * Upload failures throw — section images are explicit user picks
 * and shipping a published post with broken / missing section images
 * would be worse than failing the whole publish. The thrown
 * `PublishArticleError` is the **section-prefixed** variant so the
 * UI copy says "a section image" instead of "the featured image".
 *
 * Stamping failures + tracking failures are best-effort: the
 * upload succeeded, the publish should proceed, the operator can
 * reconcile via WP admin.
 *
 * Filename priority: section heading → article target keyword →
 * article title. Section heading lives in `alt_text` slot of the
 * filename builder so we get `desk-with-laptop.jpg` even when the
 * row's own `alt_text` is null (the slot heading is always set).
 */
async function ensureSectionMediaUploaded(opts: {
  article: ArticleForPublish;
  sectionRows: ArticleImageUploadRow[];
  wpUrl: string;
  auth: string;
  fetchImpl: typeof fetch;
  client: Client;
}): Promise<SectionUploadResult[]> {
  const { article, sectionRows, wpUrl, auth, fetchImpl, client } = opts;
  const out: SectionUploadResult[] = [];
  for (const row of sectionRows) {
    if (row.wp_media_id) {
      // Cached id reuse — skip upload + tracking entirely.
      // `row.section_key ?? ""` is defensive — callers
      // (`syncArticleToWordPress`) filter to rows whose section_key
      // is in the saved body before passing them here, so the null
      // branch is unreachable in practice.
      out.push({
        /* v8 ignore next 1 -- defensive: filtered upstream by `row.section_key && validKeys.has(...)` */
        sectionKey: row.section_key ?? "",
        wpMediaId: row.wp_media_id,
        imageUrl: row.image_url,
        altText: row.alt_text,
        provider: row.provider,
        photographerName: row.photographer_name,
        photographerProfileUrl: row.photographer_profile_url,
        photoUrl: row.photo_url,
        downloadLocation: row.download_location,
      });
      continue;
    }

    let result: Awaited<ReturnType<typeof uploadMediaToWordPressWithAuth>>;
    try {
      result = await uploadMediaToWordPressWithAuth({
        wpUrl,
        auth,
        imageUrl: row.image_url,
        altText: row.alt_text,
        filenameContext: {
          // Section heading is the most specific descriptor → use
          // it as the alt-equivalent for the filename slug. If the
          // row's own alt text is set, prefer that.
          featuredImageAlt: row.alt_text ?? row.section_heading,
          targetKeyword: article.target_keyword,
          articleTitle: article.title,
        },
        fetchImpl,
      });
    } catch (err) {
      throw toSectionImageError(err);
    }

    // Stamp the WP media id back onto the section row. Best-effort —
    // a failure here means the next publish re-uploads (WordPress
    // dedupes by filename, so worst case is a slightly-renamed
    // duplicate in the media library, not user-visible breakage).
    /* v8 ignore start -- defensive: stamping failure is best-effort and doesn't fail the publish */
    try {
      await stampWordPressMediaIdOnImageUpload({
        rowId: row.id,
        wpMediaId: result.mediaId,
        client,
      });
    } catch {
      // Swallow.
    }
    /* v8 ignore stop */

    // Fire the provider's download tracker (Unsplash etc.). Same
    // best-effort posture as the featured-image bookkeeping —
    // failures here never fail the publish.
    /* v8 ignore start -- defensive: download tracking is best-effort + provider adapters never throw, but the wrap survives a future regression */
    try {
      if (row.download_location) {
        const provider = getImageProvider(row.provider);
        await provider.trackDownload({
          downloadLocation: row.download_location,
          fetchImpl,
        });
      }
    } catch (err) {
      // Adapter not registered for `row.provider` (e.g. legacy /
      // future provider not in the registry). The ImageSearchError
      // is the typed "not registered" signal; anything else
      // re-throws so the test suite catches unexpected runtime
      // errors.
      if (!(err instanceof ImageSearchError)) throw err;
    }
    /* v8 ignore stop */

    out.push({
      /* v8 ignore next 1 -- defensive: filtered upstream by `row.section_key && validKeys.has(...)` */
      sectionKey: row.section_key ?? "",
      wpMediaId: result.mediaId,
      // Prefer the WP-side source_url — it's the canonical URL on
      // the WP site (closer to the post + survives if the original
      // remote URL goes away). Fall back to the original image_url
      // when WP didn't echo source_url (older WP versions).
      imageUrl: result.sourceUrl ?? row.image_url,
      altText: row.alt_text,
      provider: row.provider,
      photographerName: row.photographer_name,
      photographerProfileUrl: row.photographer_profile_url,
      photoUrl: row.photo_url,
      downloadLocation: row.download_location,
    });
  }
  return out;
}

/**
 * Projects the section-upload results into the `sectionImagesByKey`
 * map shape the markdown-to-html injector consumes. Kept separate
 * from `ensureSectionMediaUploaded` so the upload helper stays
 * focused on side effects and the projection stays a pure function
 * (testable + safe to call multiple times).
 */
function buildSectionImagesByKey(
  results: SectionUploadResult[],
): Record<string, SectionImageForHtml> {
  const map: Record<string, SectionImageForHtml> = {};
  for (const r of results) {
    /* v8 ignore next 1 -- defensive: ensureSectionMediaUploaded only emits results with non-empty sectionKey (filtered upstream); guard kept so a future caller can't accidentally produce empty-keyed map entries */
    if (!r.sectionKey) continue;
    map[r.sectionKey] = {
      imageUrl: r.imageUrl,
      altText: r.altText,
      wpMediaId: r.wpMediaId,
      attribution: {
        provider: r.provider,
        photographerName: r.photographerName,
        photographerProfileUrl: r.photographerProfileUrl,
        photoUrl: r.photoUrl,
      },
    };
  }
  return map;
}

/**
 * Best-effort post-upload work: provider-specific download ping +
 * stamp the `wp_media_id` on the attribution row. Never throws —
 * the WP post is already on its way and we don't want a stat-
 * tracking failure to roll back a successful publish.
 *
 * Routes through the image-provider registry so any provider that
 * has tracking semantics (Unsplash today; future Pexels etc.) gets
 * its `trackDownload` called by reading the `provider` column off
 * the attribution row. Providers without tracking are no-ops via
 * the `not_supported` reason in their adapter.
 */
async function runPostUploadBookkeeping(opts: {
  article: ArticleForPublish;
  wpMediaId: number;
  fetchImpl: typeof fetch;
  client: Client;
}): Promise<void> {
  const { article, wpMediaId, fetchImpl, client } = opts;
  /* v8 ignore start -- defensive: bookkeeping is best-effort; any thrown error here would mask a successful WP publish, so we swallow at the outermost layer */
  try {
    const row = await getActiveImageUploadForArticle(
      article.id,
      article.featured_image_url,
      client,
    );
    if (!row) return;

    // Look up the provider adapter by name. If the provider is not
    // registered (legacy row, manual seed, etc.) skip tracking but
    // still stamp `wp_media_id` below — the publish itself is still
    // a success and the tracker is best-effort by design.
    let provider:
      | ReturnType<typeof getImageProvider>
      | null = null;
    try {
      provider = getImageProvider(row.provider);
    } catch (err) {
      if (!(err instanceof ImageSearchError)) throw err;
    }

    if (provider && row.download_location) {
      // Adapter contract: never throws, returns a typed result.
      // Wrapped anyway in case a future provider regresses on that.
      await provider.trackDownload({
        downloadLocation: row.download_location,
        fetchImpl,
      });
    }

    // Cache the WP media id on the attribution row only if it
    // wasn't already set (avoid a needless write when the row was
    // pre-stamped by the editor save's wp_media_id reuse path).
    if (row.wp_media_id !== wpMediaId) {
      await stampWordPressMediaIdOnImageUpload({
        rowId: row.id,
        wpMediaId,
        client,
      });
    }
  } catch {
    // Swallow — the publish itself succeeded.
  }
  /* v8 ignore stop */
}

/**
 * Picks a sensible filename for the `Content-Disposition` header
 * from the source URL. Falls back to `featured-image.<ext>` when
 * the URL doesn't carry a filename (e.g. signed CDN URLs ending
 * in `?token=...`).
 */
function deriveFilename(imageUrl: string, contentType: string): string {
  try {
    const parsed = new URL(imageUrl);
    const last = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    if (last.includes(".")) return last;
  } catch {
    // fallthrough to the extension-from-content-type fallback
  }
  // `image/png` → `png`, `image/jpeg` → `jpeg`. Default to bin so
  // WordPress doesn't reject for an empty extension.
  const ext = contentType.split("/")[1]?.split(";")[0]?.trim() || "bin";
  return `featured-image.${ext}`;
}

/**
 * Strips characters that would break the `Content-Disposition`
 * filename header (quotes, control chars, path separators). The
 * regex keeps it simple: alphanumerics, dot, hyphen, underscore.
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}
