import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { extractArticleSections } from "@/lib/extract-article-sections";
import {
  listRecentImageKeysForBlog,
  listSectionImageRowsForArticle,
  recordArticleImageUpload,
  type SelectedImageMetadata,
} from "./article-image-upload-service";
import {
  DEFAULT_IMAGE_PROVIDER_ID,
  getImageProvider,
} from "./image-providers/registry";
import {
  ImageSearchError,
  type ImageSearchProvider,
  type NormalizedImageSearchResult,
} from "./image-providers/types";

/**
 * Best-effort image picker for AI-generated articles.
 *
 * Runs after `runGenerateArticleFromIdeaJob` saves the draft so the
 * article lands in `ready_for_review` already populated with a
 * featured image + one image per H2 section. Mirrors what a user
 * would do by hand in the editor — same `article_image_uploads`
 * rows, same `articles.featured_image_url`/`featured_image_alt`,
 * same `wp_featured_media_id` clearing posture.
 *
 * Designed never to throw. Per-image failures are collected as
 * `warnings` and returned. The article-generation job catches any
 * exception that DOES escape (defensive) and refuses to refund —
 * the article + tokens are already settled by the time we get
 * here, so an image picker miss is a UX nit, not a billing event.
 *
 * What we deliberately do NOT do:
 *   * Provider `trackDownload` is never fired during selection.
 *     Unsplash's API guidelines say to ping `download_location`
 *     on **actual use** (the WordPress media upload). Firing here
 *     would double-count + count picks the user later removes.
 *     Pexels has no tracking concept at all — its adapter no-ops.
 *   * Existing images are preserved (manual picks win over autopilot)
 *     unless `force: true` is passed. Lets a user "reset to auto"
 *     by clearing their picks + re-running the picker without us
 *     overwriting an in-progress manual selection.
 *
 * Diversity:
 *   The featured + every section pick share a single
 *   `usedImageKeys: Set<string>`. Each successful pick adds two
 *   keys to it: a strong `provider:providerPhotoId` key AND a
 *   fallback `regularUrl` key (catches the rare case where two
 *   provider rows produce the same hosted URL). On every search
 *   we walk the candidate list and pick the first photo whose
 *   keys are NOT yet in the set. If the chain runs out without
 *   finding a fresh candidate, we fall through to "no result"
 *   rather than reusing — duplicate hero + section images on the
 *   same article looked obviously stale, which is why we widen
 *   `perPage` to {@link AUTO_IMAGE_SEARCH_PER_PAGE} (15) so the
 *   provider has room to surface alternatives.
 *
 *   Cross-article diversity (v13): the `usedImageKeys` set is
 *   ALSO seeded at the start of `pickImagesForArticle` from
 *   `article_image_uploads` rows belonging to OTHER recent
 *   articles in the same blog (see
 *   {@link RECENT_IMAGE_DIVERSITY_WINDOW_DAYS} +
 *   {@link RECENT_IMAGE_DIVERSITY_LIMIT}). Without that seed,
 *   Pexels' top result for a recurring keyword could land on
 *   five articles in a row.
 *
 * Query derivation:
 *   * Featured: `article.target_keyword` → `article.title` → `blog.niche`.
 *   * Section: section heading text, optionally suffixed with
 *     `article.target_keyword` when both exist and differ (gives the
 *     provider's relevance ranker the article topic on top of the
 *     heading's specificity).
 */

/**
 * Per-page count the autopilot picker requests from the provider
 * for each query attempt. Wide enough that the dedupe logic
 * almost always finds a non-used candidate without paginating
 * (Pexels' free tier caps at 200 req/hour — paginating would
 * burn that quota for marginal gains). Narrow enough that the
 * client-side pick loop stays fast and doesn't allocate a giant
 * array of candidates we'll never use.
 *
 * Manual picker still defaults to its own (smaller) perPage value
 * because the user only selects one image per click.
 */
export const AUTO_IMAGE_SEARCH_PER_PAGE = 15;

/**
 * Lookback window (in days) used to seed `usedImageKeys` with
 * images already chosen for OTHER recent articles in the same
 * blog. Stops Pexels' top hit for a recurring keyword (e.g. a
 * blog's target niche) from landing as the featured image on
 * five consecutive posts.
 *
 * 30 days balances diversity against the provider's library
 * size: too short and the same photo cycles back too quickly;
 * too long and a small-niche blog runs out of fresh candidates
 * mid-month. Operators can override per-call via the input;
 * there's no settings UI today.
 */
export const RECENT_IMAGE_DIVERSITY_WINDOW_DAYS = 30;

/**
 * Maximum number of recent image rows we read to build the
 * cross-article dedupe seed. Capped to keep the read fast on
 * busy blogs and to avoid pulling the entire table.
 *
 * Sizing heuristic: 5 articles/day × 6 images/article × 30 days
 * = 900 images for a heavy blog, but a 250-row cap covers ~6
 * weeks at a more realistic 1 article/day × 6 images/article =
 * 180 images. The diversity guarantee weakens past the cap
 * (older images outside the limit can be re-picked), which we
 * accept for v1.
 */
export const RECENT_IMAGE_DIVERSITY_LIMIT = 250;

type Client = SupabaseClient<Database>;

export interface PickImagesForArticleInput {
  articleId: string;
  blogId: string;
  /** Defaults to the registry's `DEFAULT_IMAGE_PROVIDER_ID` (`'unsplash'` today). */
  providerId?: string;
  /** Default: `true`. Set `false` to skip the featured-image pick. */
  includeFeatured?: boolean;
  /** Default: `true`. Set `false` to skip section image picks. */
  includeSections?: boolean;
  /**
   * When `true`, overwrite existing picks (featured image AND any
   * section row matching a current H2's `section_key`). When
   * `false` (default), skip rows where the user / a previous
   * autopilot pass already populated something.
   */
  force?: boolean;
  client?: Client;
  fetchImpl?: typeof fetch;
}

export interface PickImagesForArticleResult {
  /** Provider id the picker tried to use. */
  providerId: string;
  /** `true` iff a featured image was selected on THIS call (not on a previous one). */
  featuredSelected: boolean;
  /** Number of H2 sections discovered in the saved body. */
  sectionsFound: number;
  /** Number of section image rows inserted on THIS call. */
  sectionImagesSelected: number;
  /**
   * Human-readable warnings collected during selection. Always a
   * defined array (empty when nothing went wrong). The
   * article-generation job's `output` includes this verbatim so a
   * future support-debug surface can read it back.
   */
  warnings: string[];
}

interface ArticleQueryRow {
  id: string;
  title: string;
  target_keyword: string | null;
  content_markdown: string | null;
  featured_image_url: string | null;
}

interface BlogQueryRow {
  niche: string | null;
  description: string | null;
}

/**
 * Loads the minimum article columns the picker needs. Uses the
 * supplied (or admin) client; the orchestrator passes a single
 * client through so all writes share the same transaction posture.
 */
async function loadArticleForPicker(
  client: Client,
  articleId: string,
  blogId: string,
): Promise<ArticleQueryRow | null> {
  const { data, error } = await client
    .from("articles")
    .select("id, title, target_keyword, content_markdown, featured_image_url")
    .eq("id", articleId)
    .eq("blog_id", blogId)
    .maybeSingle();
  if (error) throw error;
  return (data as ArticleQueryRow | null) ?? null;
}

async function loadBlogForPicker(
  client: Client,
  blogId: string,
): Promise<BlogQueryRow | null> {
  const { data, error } = await client
    .from("blogs")
    .select("niche, description")
    .eq("id", blogId)
    .maybeSingle();
  /* v8 ignore next 1 -- defensive: caught by outer pickImagesForArticle try/catch and surfaced as a warning */
  if (error) throw error;
  return (data as BlogQueryRow | null) ?? null;
}

/**
 * Featured-image query chain: target keyword → title → blog niche.
 * Each entry is tried in order; the first that returns results
 * wins. Empty strings are filtered out so a missing field
 * doesn't burn a provider call on `""`. The chain is empty when
 * none of the three source fields are set — caller short-circuits
 * + warns.
 */
function buildFeaturedQueries(
  article: ArticleQueryRow,
  blog: BlogQueryRow | null,
): string[] {
  const chain: string[] = [];
  const keyword = article.target_keyword?.trim();
  if (keyword) chain.push(keyword);
  const title = article.title?.trim();
  if (title) chain.push(title);
  const niche = blog?.niche?.trim();
  if (niche) chain.push(niche);
  // De-dup so a blog whose `niche` matches the article `title`
  // doesn't re-issue the same search twice.
  return Array.from(new Set(chain));
}

/**
 * Section-image query chain (most-specific → most-generic):
 *
 *   1. `heading + keyword` — best signal: this section, on this
 *      article's topic.
 *   2. `heading` alone — broader; helpful when the keyword + heading
 *      combo is over-specified and Unsplash returns zero hits.
 *   3. `keyword || title` — article-wide fallback; gives us
 *      something on-topic even when the heading is too unusual
 *      for the provider's library.
 *
 * Entries are de-duped (when keyword equals heading, step 1 is
 * the same as step 2). Empty strings are filtered out so a missing
 * keyword doesn't burn a search call.
 */
function buildSectionQueries(
  sectionHeading: string,
  article: ArticleQueryRow,
): string[] {
  const heading = sectionHeading.trim();
  const keyword = article.target_keyword?.trim();
  const title = article.title?.trim();
  const chain: string[] = [];
  if (heading && keyword && keyword.toLowerCase() !== heading.toLowerCase()) {
    chain.push(`${heading} ${keyword}`);
  }
  if (heading) chain.push(heading);
  // Article-wide fallback: keyword first, then title. Done as a
  // sequence of pushes (instead of `keyword ?? title ?? ""`) so v8
  // branch coverage sees each step independently. `new Set` below
  // dedupes if both happen to match `heading`.
  if (keyword) chain.push(keyword);
  else if (title) chain.push(title);
  return Array.from(new Set(chain));
}

/**
 * Alt-text fallback chain. Prefer the provider's own
 * `altDescription` (most accessible), then `description`, then
 * `Image for "<context>"` (helpful for screen readers when the
 * provider gives us nothing). Capped at 300 chars so a malicious
 * provider response can't write a 10KB alt attribute on the
 * `<img>`.
 */
function pickAltText(
  photo: NormalizedImageSearchResult,
  fallbackContext: string,
): string {
  // The `: ""` falsy branch of the ternary below is unreachable in
  // practice — callers always pass a non-empty `fallbackContext`
  // (article title for featured, section heading for sections),
  // and the query-derivation short-circuits before we reach this
  // helper when both are blank.
  /* v8 ignore start -- defensive: empty fallbackContext is unreachable from real callers */
  const raw =
    photo.altDescription?.trim() ||
    photo.description?.trim() ||
    (fallbackContext ? `Image for "${fallbackContext}"` : "");
  /* v8 ignore stop */
  return raw.slice(0, 300);
}

/**
 * Maps a provider result + chosen alt text to the
 * `SelectedImageMetadata` shape the persistence layer accepts.
 * Section-specific fields (`role`, `sectionKey`, etc.) are added
 * by the caller — this only carries provider attribution.
 */
function photoToMetadata(
  photo: NormalizedImageSearchResult,
  altText: string,
): SelectedImageMetadata {
  return {
    provider: photo.provider,
    providerPhotoId: photo.providerPhotoId,
    imageUrl: photo.regularUrl,
    /* v8 ignore next 1 -- defensive: pickAltText always returns non-empty for callers that pass a fallback context (title / section heading); the `|| null` is a future-regression guard */
    altText: altText || null,
    photographerName: photo.photographerName ?? null,
    photographerProfileUrl: photo.photographerProfileUrl ?? null,
    photoUrl: photo.photoUrl ?? null,
    downloadLocation: photo.downloadLocation ?? null,
    // No cached WP media id — autopilot picks always upload fresh
    // on the next WordPress sync.
    wpMediaId: null,
  };
}

/**
 * Builds the dedupe keys for a candidate photo. We compose two keys
 * (and add BOTH to the used set on a successful pick):
 *
 *   * `provider:providerPhotoId` — the strong identity key. Two rows
 *     from the same provider with the same id are the same photo.
 *   * `url:<regularUrl>` — the fallback key. Catches the case where
 *     two distinct provider rows coincidentally point at the same
 *     hosted URL (rare in practice but worth guarding so the
 *     featured + section images can never share the same on-page
 *     `<img src>`).
 */
function imageDedupeKeys(photo: NormalizedImageSearchResult): string[] {
  return [
    `${photo.provider}:${photo.providerPhotoId}`,
    `url:${photo.regularUrl}`,
  ];
}

/**
 * Walks a search-result list and returns the first photo whose
 * dedupe keys are not yet in `usedImageKeys`. Returns `null` when
 * every result is already used (so the caller can fall through to
 * the next query in the chain or warn).
 *
 * `usedImageKeys` is NOT mutated here — the caller adds the chosen
 * photo's keys after deciding to use it (so a search-with-fallback
 * call that later returns "no_results" doesn't poison the set).
 */
function pickFirstUnused(
  results: NormalizedImageSearchResult[],
  usedImageKeys: Set<string>,
): NormalizedImageSearchResult | null {
  for (const photo of results) {
    const keys = imageDedupeKeys(photo);
    if (keys.some((k) => usedImageKeys.has(k))) continue;
    return photo;
  }
  return null;
}

/**
 * Outcome of {@link searchWithFallback}. Carries either the chosen
 * photo + the query that produced it, or a typed reason for why no
 * photo was found. The caller writes a single warning per failed
 * pick (not one per query) so the autopilot-warnings list stays
 * digestible.
 *
 * Three failure variants:
 *   * `provider_error` — the provider threw an `ImageSearchError`
 *     (rate limit, missing access key, malformed response). We
 *     short-circuit the chain so a 429 on query #1 doesn't burn
 *     the rest of the rate-limit window.
 *   * `no_results` — every query in the chain returned an empty
 *     candidate list. Suggests a too-niche query, a typo, or a
 *     genuinely small library for the topic.
 *   * `all_used` — the provider returned candidates for at least
 *     one query, but every candidate was already in
 *     `usedImageKeys` (recent-blog seed + within-article picks).
 *     Distinct from `no_results` because the recovery hint is
 *     different: "library is small / blog has saturated the
 *     provider's top hits for this niche" not "your query is
 *     wrong".
 */
type FallbackSearchOutcome =
  | { photo: NormalizedImageSearchResult; query: string }
  | { photo: null; reason: "provider_error"; details: string }
  | { photo: null; reason: "no_results"; lastQuery: string }
  | { photo: null; reason: "all_used"; lastQuery: string };

/**
 * Walks a query chain calling `searchImages` in sequence until one
 * returns a non-already-used photo. Each query asks the provider
 * for {@link AUTO_IMAGE_SEARCH_PER_PAGE} candidates so the dedupe
 * pass has room to skip past photos that were already picked for
 * the featured slot or earlier sections.
 *
 * Provider errors short-circuit the chain — if the provider rate-
 * limits on query #1, trying query #2 immediately would just hit
 * the same limit; we surface the error and let the caller warn.
 *
 * `usedImageKeys` is read-only inside this function. The caller
 * adds the chosen photo's keys to the set after deciding to commit
 * the pick (so a `no_results` / `all_used` outcome doesn't
 * accidentally poison the set with photos we ended up not using).
 */
async function searchWithFallback(
  provider: ImageSearchProvider,
  queries: string[],
  usedImageKeys: Set<string>,
  fetchImpl?: typeof fetch,
): Promise<FallbackSearchOutcome> {
  let lastQuery = "";
  // Tracks whether ANY query returned at least one candidate
  // photo. Lets us distinguish `no_results` (zero photos
  // anywhere in the chain) from `all_used` (photos came back
  // but every one was filtered out by the recent-blog dedupe).
  let sawAnyCandidate = false;
  for (const query of queries) {
    lastQuery = query;
    try {
      const result = await provider.searchImages({
        query,
        perPage: AUTO_IMAGE_SEARCH_PER_PAGE,
        fetchImpl,
      });
      if (result.results.length > 0) sawAnyCandidate = true;
      const photo = pickFirstUnused(result.results, usedImageKeys);
      if (photo) return { photo, query };
    } catch (err) {
      /* v8 ignore next 1 -- defensive: provider adapters only throw ImageSearchError */
      if (!(err instanceof ImageSearchError)) throw err;
      return {
        photo: null,
        reason: "provider_error",
        details: err.code,
      };
    }
  }
  return {
    photo: null,
    reason: sawAnyCandidate ? "all_used" : "no_results",
    lastQuery,
  };
}

/**
 * Marks a photo as used so subsequent picks in the same article
 * skip it. Adds both dedupe keys ({@link imageDedupeKeys}) so a
 * future row that matches EITHER key is filtered out.
 */
function markImageUsed(
  photo: NormalizedImageSearchResult,
  usedImageKeys: Set<string>,
): void {
  for (const key of imageDedupeKeys(photo)) {
    usedImageKeys.add(key);
  }
}

/**
 * Picks section images for every H2 in the saved body. Skips
 * sections that already have a row (manual / previous-pass pick)
 * unless `force: true`. Each section's failure is isolated — one
 * provider rate-limit doesn't kill the rest of the picks.
 *
 * `usedImageKeys` is the running dedupe set shared with the
 * featured pick — every successful section pick adds its dedupe
 * keys so later sections (and any subsequent featured retry) skip
 * the same photo. We also seed the set with the URLs of any
 * existing section rows so a `force=false` re-run doesn't pick the
 * same photo for a different section.
 */
async function pickSectionImages(opts: {
  client: Client;
  provider: ImageSearchProvider;
  article: ArticleQueryRow;
  blogId: string;
  force: boolean;
  warnings: string[];
  usedImageKeys: Set<string>;
  fetchImpl?: typeof fetch;
}): Promise<{ sectionsFound: number; sectionImagesSelected: number }> {
  const {
    client,
    provider,
    article,
    blogId,
    force,
    warnings,
    usedImageKeys,
    fetchImpl,
  } = opts;

  const sections = extractArticleSections(article.content_markdown);
  if (sections.length === 0) {
    return { sectionsFound: 0, sectionImagesSelected: 0 };
  }

  const existingRows = await listSectionImageRowsForArticle(article.id, client);
  const existingByKey = new Map<string, true>();
  for (const row of existingRows) {
    /* v8 ignore next 1 -- defensive: section rows always have a non-null section_key by `recordArticleImageUpload`'s write contract; falsy branch is unreachable */
    if (row.section_key) existingByKey.set(row.section_key, true);
    // Seed dedupe with existing URLs so a partial re-pick (force=false +
    // some sections already filled) doesn't pick the same image again.
    if (row.image_url) usedImageKeys.add(`url:${row.image_url}`);
    if (row.provider && row.provider_photo_id) {
      usedImageKeys.add(`${row.provider}:${row.provider_photo_id}`);
    }
  }

  let selected = 0;
  for (const section of sections) {
    if (existingByKey.has(section.sectionKey) && !force) continue;

    const queries = buildSectionQueries(section.sectionHeading, article);
    if (queries.length === 0) {
      warnings.push(
        `Skipped section "${section.sectionHeading}": no query to search.`,
      );
      continue;
    }

    const outcome = await searchWithFallback(
      provider,
      queries,
      usedImageKeys,
      fetchImpl,
    );
    if (outcome.photo === null) {
      if (outcome.reason === "provider_error") {
        warnings.push(
          `Skipped section "${section.sectionHeading}": provider search failed (${outcome.details}).`,
        );
      } else if (outcome.reason === "all_used") {
        // Provider returned candidates but they all matched the
        // dedupe set — typically because the recent-blog seed
        // has consumed the provider's top hits for this niche.
        warnings.push(
          `Skipped section "${section.sectionHeading}": no unused images found in recent blog history.`,
        );
      } else {
        warnings.push(
          `Skipped section "${section.sectionHeading}": no results for "${outcome.lastQuery}" after ${queries.length} ${queries.length === 1 ? "attempt" : "attempts"}.`,
        );
      }
      continue;
    }

    // Mark the chosen photo used BEFORE writing so that if the
    // insert below somehow throws, the next section still sees a
    // consistent dedupe set (the outer try/catch swallows + the
    // partial state is fine; we'd rather skip a duplicate than
    // accidentally double-pick a photo).
    markImageUsed(outcome.photo, usedImageKeys);

    const altText = pickAltText(outcome.photo, section.sectionHeading);
    await recordArticleImageUpload({
      articleId: article.id,
      blogId,
      role: "section",
      metadata: {
        ...photoToMetadata(outcome.photo, altText),
        role: "section",
        sectionKey: section.sectionKey,
        sectionHeading: section.sectionHeading,
        sortOrder: section.sortOrder,
      },
      client,
    });
    selected += 1;
  }

  return { sectionsFound: sections.length, sectionImagesSelected: selected };
}

/**
 * Top-level entry point. Loads the article + blog once, looks up
 * the provider via the registry, then runs the featured + section
 * pickers in sequence. Returns a summary the orchestrator can
 * splice into `article_jobs.output`. Never throws.
 */
export async function pickImagesForArticle(
  input: PickImagesForArticleInput,
): Promise<PickImagesForArticleResult> {
  const includeFeatured = input.includeFeatured ?? true;
  const includeSections = input.includeSections ?? true;
  const client = input.client ?? createAdminClient();
  const providerId = input.providerId ?? DEFAULT_IMAGE_PROVIDER_ID;
  const warnings: string[] = [];

  // Provider lookup. Unregistered providers (or env-misconfigured
  // ones) produce a typed warning + no images. The orchestrator
  // still completes the article job successfully.
  let provider: ImageSearchProvider;
  try {
    provider = getImageProvider(providerId);
  } catch (err) {
    /* v8 ignore next 1 -- defensive: registry only throws ImageSearchError; any other error would be a future regression */
    if (!(err instanceof ImageSearchError)) throw err;
    warnings.push(
      `Image provider "${providerId}" is not available (${err.code}).`,
    );
    return {
      providerId,
      featuredSelected: false,
      sectionsFound: 0,
      sectionImagesSelected: 0,
      warnings,
    };
  }

  // Article load. Missing rows are a misconfiguration (caller
  // passed the wrong articleId); we warn rather than throw so the
  // orchestrator doesn't refund tokens for an image-picker
  // accident.
  let article: ArticleQueryRow | null;
  try {
    article = await loadArticleForPicker(client, input.articleId, input.blogId);
  } catch (err) {
    /* v8 ignore next 1 -- defensive: Supabase rejection is always an Error; non-Error throws are a future-regression guard */
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to load article for image picker: ${message}`);
    return {
      providerId,
      featuredSelected: false,
      sectionsFound: 0,
      sectionImagesSelected: 0,
      warnings,
    };
  }
  if (!article) {
    warnings.push("Article not found for image picker.");
    return {
      providerId,
      featuredSelected: false,
      sectionsFound: 0,
      sectionImagesSelected: 0,
      warnings,
    };
  }

  let blog: BlogQueryRow | null = null;
  try {
    blog = await loadBlogForPicker(client, input.blogId);
    /* v8 ignore start -- defensive: blog read failure is a hard misconfig; we warn rather than throw so the picker stays best-effort */
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to load blog metadata: ${message}`);
  }
  /* v8 ignore stop */

  let featuredSelected = false;
  let sectionsFound = 0;
  let sectionImagesSelected = 0;

  // Shared dedupe set for the whole article. Mutated by both
  // `pickFeaturedImageInner` and `pickSectionImages` so they pick
  // disjoint photos. Three sources of seed data feed this set:
  //
  //   1. Cross-article diversity (this PR, v13): every image
  //      already chosen for ANOTHER recent article in the same
  //      blog. Stops Pexels' top hit for a recurring keyword
  //      from landing on five posts in a row. Bounded by
  //      {@link RECENT_IMAGE_DIVERSITY_WINDOW_DAYS} +
  //      {@link RECENT_IMAGE_DIVERSITY_LIMIT} so the read stays
  //      cheap on busy blogs.
  //   2. Within-article re-pick guard: existing featured /
  //      section rows from THIS article (added inside
  //      `pickFeaturedImageInner` + `pickSectionImages` when
  //      they read existing rows for the `force=false` short-
  //      circuit). Keeps a partial re-run from picking a manual
  //      featured photo as a section image.
  //   3. Within-pick disjoint guard: each successful pick adds
  //      its own keys before the next pick runs.
  //
  // The recent-blog seed is best-effort: a transient supabase
  // failure here would weaken diversity, not break the picker.
  // We catch and warn rather than aborting the run — the
  // article's tokens are already settled and users would rather
  // see a slightly-repeated image than no images at all.
  const usedImageKeys = new Set<string>();
  try {
    const recentKeys = await listRecentImageKeysForBlog({
      blogId: input.blogId,
      excludeArticleId: input.articleId,
      providerId: input.providerId ?? providerId,
      sinceDays: RECENT_IMAGE_DIVERSITY_WINDOW_DAYS,
      limit: RECENT_IMAGE_DIVERSITY_LIMIT,
      client,
    });
    for (const key of recentKeys) usedImageKeys.add(key);
    /* v8 ignore start -- defensive: recent-history seed failure is best-effort; the picker continues without cross-article diversity rather than failing the article job */
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(
      `Recent-image diversity seed failed (${message}); continuing without cross-article dedupe.`,
    );
  }
  /* v8 ignore stop */

  // Featured. Wrapped in try so an unexpected DB write error (e.g.
  // RLS misconfig) doesn't kill the section-image pass.
  if (includeFeatured) {
    try {
      featuredSelected = await pickFeaturedImageInner({
        client,
        provider,
        article,
        blog,
        blogId: input.blogId,
        force: input.force ?? false,
        warnings,
        usedImageKeys,
        fetchImpl: input.fetchImpl,
      });
      /* v8 ignore start -- defensive: pickFeaturedImageInner only throws on unexpected DB errors during write; warning collected so section pass still runs */
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Featured image selection errored: ${message}`);
    }
    /* v8 ignore stop */
  }

  if (includeSections) {
    try {
      const result = await pickSectionImages({
        client,
        provider,
        article,
        blogId: input.blogId,
        force: input.force ?? false,
        warnings,
        usedImageKeys,
        fetchImpl: input.fetchImpl,
      });
      sectionsFound = result.sectionsFound;
      sectionImagesSelected = result.sectionImagesSelected;
      /* v8 ignore start -- defensive: pickSectionImages catches per-section provider errors; outer catch covers DB write regressions */
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Section image selection errored: ${message}`);
    }
    /* v8 ignore stop */
  }

  return {
    providerId,
    featuredSelected,
    sectionsFound,
    sectionImagesSelected,
    warnings,
  };
}

/**
 * Inner featured-image helper. Same shape as `pickSectionImages`
 * but returns a single boolean. Kept as a private fn so the top-
 * level `pickImagesForArticle` can wrap it in its own catch
 * without polluting the public surface.
 *
 * Adds the chosen photo's keys to `usedImageKeys` on success so
 * the section pass that runs after this skips re-using the
 * featured photo for any section.
 */
async function pickFeaturedImageInner(opts: {
  client: Client;
  provider: ImageSearchProvider;
  article: ArticleQueryRow;
  blog: BlogQueryRow | null;
  blogId: string;
  force: boolean;
  warnings: string[];
  usedImageKeys: Set<string>;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const {
    client,
    provider,
    article,
    blog,
    blogId,
    force,
    warnings,
    usedImageKeys,
    fetchImpl,
  } = opts;

  if (article.featured_image_url?.trim() && !force) {
    // Existing manual / previous-autopilot featured pick — seed
    // the dedupe set with its URL so the section pass doesn't
    // accidentally pick the same image for a section.
    usedImageKeys.add(`url:${article.featured_image_url}`);
    return false;
  }

  const queries = buildFeaturedQueries(article, blog);
  if (queries.length === 0) {
    warnings.push(
      "Skipped featured image: no target keyword, title, or blog niche to derive a search query.",
    );
    return false;
  }

  const outcome = await searchWithFallback(
    provider,
    queries,
    usedImageKeys,
    fetchImpl,
  );
  if (outcome.photo === null) {
    if (outcome.reason === "provider_error") {
      warnings.push(
        `Skipped featured image: provider search failed (${outcome.details}).`,
      );
    } else if (outcome.reason === "all_used") {
      warnings.push(
        "Skipped featured image: no unused images found in recent blog history.",
      );
    } else {
      warnings.push(
        `Skipped featured image: no results for "${outcome.lastQuery}" after ${queries.length} ${queries.length === 1 ? "attempt" : "attempts"}.`,
      );
    }
    return false;
  }
  const photo = outcome.photo;

  // Mark used BEFORE writing the article + attribution rows so
  // the section pass (which shares this set) can never pick the
  // same photo even if a write below throws.
  markImageUsed(photo, usedImageKeys);

  const altText = pickAltText(photo, article.title);

  // Mirror the manual-edit save posture: writing a new
  // `featured_image_url` always clears `wp_featured_media_id` so
  // the next WP publish/update uploads the fresh image.
  const { error: updateErr } = await client
    .from("articles")
    .update({
      featured_image_url: photo.regularUrl,
      featured_image_alt: altText,
      wp_featured_media_id: null,
    })
    .eq("id", article.id);
  /* v8 ignore next 1 -- defensive: caught by outer pickImagesForArticle try/catch + warned; the outer wrapper makes this throw safe */
  if (updateErr) throw updateErr;

  await recordArticleImageUpload({
    articleId: article.id,
    blogId,
    metadata: photoToMetadata(photo, altText),
    client,
  });
  return true;
}
