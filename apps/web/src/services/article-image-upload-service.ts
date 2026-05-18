import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Database,
  Tables,
  TablesInsert,
} from "@/lib/supabase/database.types";

/**
 * CRUD helpers for `article_image_uploads`.
 *
 * Lives separate from `article-service.ts` because:
 *   * The image-uploads table grows independently of `articles`
 *     (per-image rows + WP-media linkage + future inline images).
 *   * The publish path (`wordpress-publish-service.ts`) writes to it
 *     too — keeping the helpers in their own module avoids dragging
 *     editor-validation imports into the publish bundle.
 *
 * RLS posture mirrors `article_jobs`: clients can SELECT for blogs
 * they're a member of (covers the article detail page + the
 * recently-used picker section), and all writes happen through the
 * admin client from server actions / the publish service that have
 * already enforced `manage_blog`.
 *
 * Active-row semantics:
 *   "Active" attribution for a given article = the most recent row
 *   matching `(article_id = X, image_url = articles.featured_image_url)`.
 *   Old rows are kept for history (an editor that toggles between
 *   two photos and lands back on the first should see the original
 *   attribution, not "no attribution").
 */

type Client = SupabaseClient<Database>;

export type ArticleImageUploadRow = Tables<"article_image_uploads">;

/**
 * Known role values for `article_image_uploads.role`. The DB column
 * is plain `text` (not a check constraint) so adding a new role in
 * a future PR doesn't require a migration; this union is the
 * compile-time pin.
 *
 *   - `featured` — the article's hero / Open Graph / WordPress
 *     featured-media image. There can be multiple rows in the table
 *     with this role (history of every featured image the article
 *     has ever had); the "active" one is the one whose `image_url`
 *     matches `articles.featured_image_url`.
 *   - `section` — image attached to a specific H2 section of the
 *     article body. Use `sectionKey` + `sectionHeading` + `sortOrder`
 *     to identify which section it belongs to. Reserved for the
 *     section-image UI in a future PR.
 */
export type ArticleImageRole = "featured" | "section";

/**
 * Provider-agnostic shape for "the image the editor just selected".
 * Only the picker hands this in today (Unsplash); future providers
 * (AI-gen, manual upload) plug in by setting a different `provider`.
 *
 * Section fields (`role`, `sectionKey`, `sectionHeading`,
 * `sortOrder`) are optional + reserved for the future section-image
 * editor. When omitted, the row is recorded as `role = 'featured'`
 * with `sort_order = 0`, preserving today's featured-image behavior.
 */
export interface SelectedImageMetadata {
  /** `'unsplash'` today; reserved values: `'manual_url'`, `'ai'`. */
  provider: string;
  /**
   * Provider's stable id for the source image (Unsplash photo id, etc.).
   * Null when the provider doesn't have one (manual paste).
   */
  providerPhotoId: string | null;
  /** Must match the URL we're about to write into `articles.featured_image_url`. */
  imageUrl: string;
  altText: string | null;
  photographerName: string | null;
  photographerProfileUrl: string | null;
  photoUrl: string | null;
  /**
   * Unsplash's `links.download_location`. The publish service GETs
   * this exactly once after a successful WP upload (per Unsplash's
   * API guidelines). Null for non-Unsplash sources.
   */
  downloadLocation: string | null;
  /**
   * If the source row already has a WP media id (e.g. picked from
   * Recently Used), forward it so the editor's article can reuse the
   * same upload. The publish service uses this to skip the upload
   * step entirely for the next sync.
   */
  wpMediaId: number | null;
  /**
   * Image slot — `'featured'` (default) or a future `'section'`
   * pick. When omitted, the writer defaults to `'featured'` to
   * preserve the v3 behavior.
   */
  role?: ArticleImageRole;
  /**
   * Section identifier, paired with `role: 'section'`. Derived
   * from {@link extractArticleSections} so the editor and the
   * picker agree on which H2 the image belongs to.
   */
  sectionKey?: string | null;
  /** Human-readable section heading for the picker UI. */
  sectionHeading?: string | null;
  /**
   * 0-indexed document-order position. For `'featured'` rows this
   * is always 0 (default). For `'section'` rows this mirrors the
   * H2's position in the article body so the section-image picker
   * can render rows in the same order as the article.
   */
  sortOrder?: number;
}

export interface RecordArticleImageUploadInput {
  articleId: string;
  blogId: string;
  metadata: SelectedImageMetadata;
  /**
   * Override the role from the metadata. When both this and
   * `metadata.role` are set, `input.role` wins (lets call-sites force
   * the role without rebuilding the metadata object). Defaults to
   * `metadata.role ?? 'featured'`.
   */
  role?: ArticleImageRole;
  client?: Client;
}

/**
 * Inserts a new attribution row. Always inserts (never upserts) so
 * historical picks survive — the active-row lookup filters by
 * current `featured_image_url` to find the latest match.
 *
 * Section fields (`section_key`, `section_heading`, `sort_order`)
 * are written when present on the metadata. For the v3 featured-
 * image flow, all three are absent and the DB defaults apply
 * (`null`, `null`, `0`).
 */
export async function recordArticleImageUpload(
  input: RecordArticleImageUploadInput,
): Promise<ArticleImageUploadRow> {
  const supabase = input.client ?? createAdminClient();
  const role: ArticleImageRole =
    input.role ?? input.metadata.role ?? "featured";
  const insert: TablesInsert<"article_image_uploads"> = {
    article_id: input.articleId,
    blog_id: input.blogId,
    provider: input.metadata.provider,
    provider_photo_id: input.metadata.providerPhotoId,
    image_url: input.metadata.imageUrl,
    alt_text: input.metadata.altText,
    photographer_name: input.metadata.photographerName,
    photographer_profile_url: input.metadata.photographerProfileUrl,
    photo_url: input.metadata.photoUrl,
    download_location: input.metadata.downloadLocation,
    wp_media_id: input.metadata.wpMediaId,
    role,
    section_key: input.metadata.sectionKey ?? null,
    section_heading: input.metadata.sectionHeading ?? null,
    sort_order: input.metadata.sortOrder ?? 0,
  };
  const { data, error } = await supabase
    .from("article_image_uploads")
    .insert(insert)
    .select("*")
    .single();
  if (error) throw error;
  return data as ArticleImageUploadRow;
}

/**
 * Returns the most recent attribution row for an article whose
 * `image_url` matches the supplied URL. Used by:
 *   * The article detail page → render attribution under the
 *     featured-image card.
 *   * The publish service → look up `download_location` and
 *     stamp `wp_media_id` after a successful WP upload.
 *
 * Filters by `role` so a future section-image lookup can target
 * `'section'` rows without colliding with featured-image attribution.
 * Defaults to `'featured'` to preserve v3 callsites that didn't pass
 * the third arg.
 *
 * Returns `null` when no row matches (manual paste with no
 * attribution row, or `imageUrl` is blank/null). Callers treat that
 * as "no attribution available" rather than an error.
 */
export async function getActiveImageUploadForArticle(
  articleId: string,
  imageUrl: string | null,
  client?: Client,
  role: ArticleImageRole = "featured",
): Promise<ArticleImageUploadRow | null> {
  if (!imageUrl) return null;
  const supabase = client ?? createAdminClient();
  const { data, error } = await supabase
    .from("article_image_uploads")
    .select("*")
    .eq("article_id", articleId)
    .eq("image_url", imageUrl)
    .eq("role", role)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ArticleImageUploadRow | null) ?? null;
}

/**
 * Returns recent image uploads for a blog, newest first. Powers the
 * "Recently used" picker section. Caps to a small N (default 12 →
 * matches the Unsplash search grid size).
 *
 * Deduplicates on `image_url`: if the same photo was used on five
 * articles, the picker shows it once, with the most recent row's
 * data. The dedupe runs in-memory because Postgres `DISTINCT ON`
 * with an unrelated ordering needs a stable PG version + `(image_url,
 * created_at desc)` index that we don't justify yet — N=12 keeps the
 * client work trivially small.
 */
export async function listRecentImageUploadsForBlog(
  blogId: string,
  options: {
    limit?: number;
    client?: Client;
    /**
     * When supplied, only return rows with this role. Defaults to
     * unfiltered (all roles) so the v3 picker continues to surface
     * every previously-used image. The future section-image picker
     * will pass `role: 'section'` to scope its recents.
     */
    role?: ArticleImageRole;
  } = {},
): Promise<ArticleImageUploadRow[]> {
  const limit = options.limit ?? 12;
  const supabase = options.client ?? createAdminClient();
  // Pull a wider window than `limit` so the in-memory dedupe still
  // produces ~`limit` distinct rows on a busy blog.
  const fetchLimit = Math.max(limit * 4, limit);
  let query = supabase
    .from("article_image_uploads")
    .select("*")
    .eq("blog_id", blogId);
  if (options.role) {
    query = query.eq("role", options.role);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(fetchLimit);
  if (error) throw error;
  const rows = (data as ArticleImageUploadRow[] | null) ?? [];
  const seen = new Set<string>();
  const out: ArticleImageUploadRow[] = [];
  for (const row of rows) {
    if (seen.has(row.image_url)) continue;
    seen.add(row.image_url);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Returns every section-image row attached to an article, ordered
 * by `sort_order` then `created_at` (oldest first). Powers:
 *   * The article detail page → render each section image above the
 *     matching H2.
 *   * The editor → preload existing picks into the form state.
 *
 * Single-pass query (no per-section round-trip). The article detail
 * page is the hottest read path for this table, so we keep it
 * `select *` to surface the full attribution + `wp_media_id` columns
 * in one call.
 */
export async function listSectionImageRowsForArticle(
  articleId: string,
  client?: Client,
): Promise<ArticleImageUploadRow[]> {
  const supabase = client ?? createAdminClient();
  const { data, error } = await supabase
    .from("article_image_uploads")
    .select("*")
    .eq("article_id", articleId)
    .eq("role", "section")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as ArticleImageUploadRow[] | null) ?? [];
}

/**
 * Desired-state shape for a section image. The save path receives a
 * `SectionImageDesiredState[]` from the editor and diffs it against
 * the existing rows in `article_image_uploads`.
 *
 * `metadata` is `null` when the slot already had an image and the
 * user only edited the alt text (we preserve the existing row's
 * `wp_media_id` + attribution columns in that case). When the user
 * picks a fresh image, `metadata` carries the full attribution from
 * the provider.
 */
export interface SectionImageDesiredState {
  sectionKey: string;
  sectionHeading: string;
  sortOrder: number;
  imageUrl: string;
  altText: string | null;
  /**
   * Full provider attribution for a brand-new pick. `null` when the
   * user is only renaming alt text on a row that already exists.
   */
  metadata: SelectedImageMetadata | null;
}

export interface SyncSectionImageRowsResult {
  inserted: number;
  updated: number;
  deleted: number;
}

/**
 * Reconciles the section-image rows in `article_image_uploads`
 * against the editor's desired state.
 *
 * Diff rules per `section_key`:
 *   - **In desired AND existing, same image_url** → UPDATE
 *     `alt_text` + `section_heading` + `sort_order`. Preserves
 *     `wp_media_id` + attribution columns so a previously-uploaded
 *     WordPress media stays linked.
 *   - **In desired AND existing, different image_url** → DELETE the
 *     old row + INSERT a new one with the supplied metadata.
 *     Drops the old `wp_media_id` so the next WP publish uploads
 *     the new image. (Mirrors the featured-image "clear
 *     `wp_featured_media_id` on URL change" semantics.)
 *   - **In desired, NOT in existing** → INSERT.
 *   - **NOT in desired, in existing** → DELETE.
 *
 * `validSectionKeys` is the set of section keys present in the
 * **saved** article body (as parsed by `extractArticleSections`).
 * Anything outside that set is treated as orphaned — both desired
 * entries with unknown keys (stale picks for headings the user
 * removed in the same save) AND existing rows whose key vanished
 * are deleted. Keeps the table from accumulating dead picks.
 *
 * Returns counts of inserted / updated / deleted rows so tests +
 * future telemetry can verify the diff did the right thing.
 */
export async function syncArticleSectionImageRows(input: {
  articleId: string;
  blogId: string;
  desired: SectionImageDesiredState[];
  validSectionKeys: Set<string>;
  client?: Client;
}): Promise<SyncSectionImageRowsResult> {
  const supabase = input.client ?? createAdminClient();

  // Filter the desired list to keys that still exist in the saved
  // body. Stale picks (heading removed in the same save) drop here.
  const desired = input.desired.filter((d) =>
    input.validSectionKeys.has(d.sectionKey),
  );

  const existingRows = await listSectionImageRowsForArticle(
    input.articleId,
    supabase,
  );
  const existingByKey = new Map<string, ArticleImageUploadRow>();
  for (const row of existingRows) {
    /* v8 ignore next 1 -- defensive: section rows are written with a non-null section_key via recordArticleImageUpload, but the column is nullable for forward-compat with future roles, so we filter here rather than assume */
    if (row.section_key) existingByKey.set(row.section_key, row);
  }

  let inserted = 0;
  let updated = 0;
  let deleted = 0;

  // Pass 1: apply each desired entry.
  for (const want of desired) {
    const current = existingByKey.get(want.sectionKey);
    if (current && current.image_url === want.imageUrl) {
      // Same image — update lightweight metadata only.
      const { error } = await supabase
        .from("article_image_uploads")
        .update({
          alt_text: want.altText,
          section_heading: want.sectionHeading,
          sort_order: want.sortOrder,
        })
        .eq("id", current.id);
      if (error) throw error;
      updated += 1;
      existingByKey.delete(want.sectionKey);
      continue;
    }
    if (current) {
      // Different image — drop the old row so wp_media_id resets,
      // then insert the new one below.
      const { error } = await supabase
        .from("article_image_uploads")
        .delete()
        .eq("id", current.id);
      if (error) throw error;
      deleted += 1;
      existingByKey.delete(want.sectionKey);
    }
    // Insert a fresh row. When `metadata` is null the user picked a
    // URL without attribution (shouldn't happen via the picker, but
    // the type allows it for manual paste flows) — synthesize a
    // minimal metadata so the insert still has every required field.
    const metadata: SelectedImageMetadata =
      want.metadata ??
      ({
        provider: "manual_url",
        providerPhotoId: null,
        imageUrl: want.imageUrl,
        altText: want.altText,
        photographerName: null,
        photographerProfileUrl: null,
        photoUrl: null,
        downloadLocation: null,
        wpMediaId: null,
      } satisfies SelectedImageMetadata);
    await recordArticleImageUpload({
      articleId: input.articleId,
      blogId: input.blogId,
      role: "section",
      metadata: {
        ...metadata,
        imageUrl: want.imageUrl,
        altText: want.altText,
        role: "section",
        sectionKey: want.sectionKey,
        sectionHeading: want.sectionHeading,
        sortOrder: want.sortOrder,
      },
      client: supabase,
    });
    inserted += 1;
  }

  // Pass 2: delete any existing rows that didn't appear in the
  // desired list — either explicitly cleared by the editor or
  // orphaned by a removed heading.
  for (const orphan of existingByKey.values()) {
    const { error } = await supabase
      .from("article_image_uploads")
      .delete()
      .eq("id", orphan.id);
    if (error) throw error;
    deleted += 1;
  }

  return { inserted, updated, deleted };
}

export interface StampWordPressMediaIdInput {
  /** The attribution row to update. */
  rowId: string;
  wpMediaId: number;
  client?: Client;
}

/**
 * Stamps `wp_media_id` onto an attribution row after the publish
 * service has uploaded the image to WordPress. Best-effort at the
 * caller layer — failures here just mean the next sync will repeat
 * the WP upload (idempotent-ish on the WP side because filenames
 * include the article slug).
 */
export async function stampWordPressMediaIdOnImageUpload(
  input: StampWordPressMediaIdInput,
): Promise<void> {
  const supabase = input.client ?? createAdminClient();
  const { error } = await supabase
    .from("article_image_uploads")
    .update({ wp_media_id: input.wpMediaId })
    .eq("id", input.rowId);
  if (error) throw error;
}
