import "server-only";

/**
 * Server-side Unsplash search helper.
 *
 * Used by the article editor's "Pick from Unsplash" picker to search
 * Unsplash for featured-image candidates. Lives in `services/` (and
 * is `server-only`) so the `UNSPLASH_ACCESS_KEY` never reaches the
 * client bundle — a stray client import fails the build.
 *
 * Surface kept narrow on purpose:
 *   * Search by free-form query string. No collections/users/topics
 *     in v1.
 *   * Always returns a sanitized {@link UnsplashSearchResult} shape;
 *     never the raw Unsplash payload (which contains URLs/blobs we
 *     don't need to ship to the client + would be a regression
 *     surface every time Unsplash adds a field).
 *   * Throws {@link UnsplashSearchError} with one of a small set of
 *     typed codes so the action layer can map them to UI copy.
 *
 * Future extensions (NOT in this PR):
 *   * `triggerDownload(downloadLocation)` — Unsplash's API guidelines
 *     require a GET to the photo's `links.download_location` whenever
 *     a user "actually downloads" the image. We capture
 *     `downloadLocation` on the result so we can wire that up the
 *     moment we add Supabase Storage / the WP upload step that
 *     persists Unsplash photos.
 *   * Pagination beyond page 1 (the picker currently only shows the
 *     first page).
 *   * Per-blog Unsplash "image_uploads" audit table for full
 *     attribution storage — see the long-form TODO above the
 *     `searchUnsplashPhotos` JSDoc.
 *
 * Why no URL-side pagination today: the picker is small (12 results
 * fit on a 4×3 grid). If users ask for "show more" we can add a
 * `page`/`perPage` UI in a follow-up; the helper already accepts the
 * args.
 */

const UNSPLASH_API_BASE = "https://api.unsplash.com";
const UNSPLASH_API_VERSION = "v1";

/**
 * Photo payload the server returns to the picker. Deliberately a
 * subset of the raw Unsplash response — anything client code doesn't
 * need (full EXIF, location, sponsorship, etc.) is dropped at the
 * server boundary so the client bundle / network response stays small.
 *
 * Keep this shape rich enough that a future "store Unsplash
 * attribution + download location" PR can persist these fields onto
 * a real `image_uploads` row without re-querying Unsplash. In v1 we
 * only persist `regularUrl` (→ `featured_image_url`) and the alt
 * description (→ `featured_image_alt`); the rest is forwarded to the
 * client and discarded after the user picks.
 */
export interface UnsplashSearchResult {
  /** Unsplash photo id; opaque, used for keys / deduplication. */
  id: string;
  /** Photo description (often empty on Unsplash). May be null. */
  description: string | null;
  /**
   * Accessibility-oriented description. Better source for
   * `featured_image_alt` than `description` since most Unsplash
   * photos have an alt but not a description.
   */
  altDescription: string | null;
  /** Small, fast-loading thumbnail URL — used in the picker grid. */
  thumbUrl: string;
  /**
   * Medium-sized URL (~1080px wide). What we save into
   * `featured_image_url` after a pick — large enough for hero
   * images, small enough that WordPress media uploads stay snappy.
   */
  regularUrl: string;
  /** Largest URL Unsplash exposes. Optional — we don't use it in v1. */
  fullUrl?: string;
  /** Photographer display name (e.g. "Annie Spratt"). */
  photographerName: string;
  /** Photographer profile URL on unsplash.com — used for attribution. */
  photographerProfileUrl: string;
  /** Direct URL to the photo on unsplash.com. */
  photoUrl: string;
  /**
   * Unsplash's tracking endpoint. Required by Unsplash's API
   * guidelines: when a user actually downloads/uses a photo, we must
   * GET this URL to count the download against the photographer's
   * stats. v1 doesn't fire this yet — see the long TODO above this
   * file. The picker forwards it to the action result so a future
   * PR can persist + ping it from the WP upload step.
   */
  downloadLocation?: string;
}

export interface SearchUnsplashPhotosInput {
  /** Free-form search text. Empty / whitespace throws `query_required`. */
  query: string;
  /**
   * 1-indexed page number, matching Unsplash's API. Defaults to 1.
   * Values < 1 are clamped to 1; the helper does NOT cap the upper
   * bound (Unsplash returns an empty list past the last page).
   */
  page?: number;
  /**
   * Page size. Defaults to 12 — fits a 4-column × 3-row grid in the
   * picker without scrolling. Capped at 30 to match Unsplash's own
   * per-page limit.
   */
  perPage?: number;
  /** Inject a `fetch` for tests. Defaults to the global. */
  fetchImpl?: typeof fetch;
  /**
   * Inject the access key for tests. Defaults to reading
   * `process.env.UNSPLASH_ACCESS_KEY` — the production path.
   */
  accessKey?: string;
}

export interface SearchUnsplashPhotosResult {
  results: UnsplashSearchResult[];
  totalResults: number;
  totalPages: number;
}

/**
 * Friendly error codes the action layer maps to UI copy. Each maps
 * to a specific failure mode the user might recover from differently
 * (config vs. transient vs. quota).
 */
export type UnsplashSearchErrorCode =
  | "query_required"
  | "missing_access_key"
  | "rate_limited"
  | "unsplash_request_failed"
  | "unsplash_invalid_response";

export class UnsplashSearchError extends Error {
  readonly code: UnsplashSearchErrorCode;
  readonly details?: string;

  constructor(code: UnsplashSearchErrorCode, details?: string) {
    super(`unsplash_search_error:${code}${details ? `:${details}` : ""}`);
    this.name = "UnsplashSearchError";
    this.code = code;
    this.details = details;
  }
}

const DEFAULT_PER_PAGE = 12;
const MAX_PER_PAGE = 30;

interface RawUnsplashUser {
  name?: string | null;
  username?: string | null;
  links?: { html?: string | null } | null;
}

interface RawUnsplashPhoto {
  id?: string;
  description?: string | null;
  alt_description?: string | null;
  urls?: {
    thumb?: string | null;
    small?: string | null;
    regular?: string | null;
    full?: string | null;
  } | null;
  links?: {
    html?: string | null;
    download_location?: string | null;
  } | null;
  user?: RawUnsplashUser | null;
}

interface RawUnsplashSearchResponse {
  results?: unknown;
  total?: unknown;
  total_pages?: unknown;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Maps one raw Unsplash photo into our normalized shape, OR returns
 * null when the row is missing fields the picker actually needs
 * (id + thumb + regular). Filtering instead of throwing keeps a
 * single bad row from sinking an otherwise-valid search response.
 */
function normalizePhoto(raw: unknown): UnsplashSearchResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const photo = raw as RawUnsplashPhoto;

  const id = typeof photo.id === "string" ? photo.id : null;
  const thumbUrl =
    typeof photo.urls?.thumb === "string" ? photo.urls.thumb : null;
  const regularUrl =
    typeof photo.urls?.regular === "string" ? photo.urls.regular : null;
  if (!id || !thumbUrl || !regularUrl) return null;

  const fullUrl =
    typeof photo.urls?.full === "string" ? photo.urls.full : undefined;
  const downloadLocation =
    typeof photo.links?.download_location === "string"
      ? photo.links.download_location
      : undefined;

  const photographerName =
    (typeof photo.user?.name === "string" && photo.user.name.trim()) ||
    (typeof photo.user?.username === "string" && photo.user.username.trim()) ||
    "Unsplash photographer";
  const photographerProfileUrl =
    (typeof photo.user?.links?.html === "string" && photo.user.links.html) ||
    "https://unsplash.com";
  const photoUrl =
    (typeof photo.links?.html === "string" && photo.links.html) ||
    "https://unsplash.com";

  return {
    id,
    description:
      typeof photo.description === "string" ? photo.description : null,
    altDescription:
      typeof photo.alt_description === "string" ? photo.alt_description : null,
    thumbUrl,
    regularUrl,
    fullUrl,
    photographerName,
    photographerProfileUrl,
    photoUrl,
    downloadLocation,
  };
}

/**
 * Searches Unsplash and returns a small, sanitized result set. Throws
 * `UnsplashSearchError` for every failure mode so the caller can
 * map to UI copy without inspecting `Error.message` strings.
 */
export async function searchUnsplashPhotos(
  input: SearchUnsplashPhotosInput,
): Promise<SearchUnsplashPhotosResult> {
  const query = input.query.trim();
  if (!query) {
    throw new UnsplashSearchError("query_required");
  }

  const accessKey = input.accessKey ?? process.env.UNSPLASH_ACCESS_KEY ?? "";
  if (!accessKey) {
    throw new UnsplashSearchError("missing_access_key");
  }

  const page = Math.max(1, input.page ?? 1);
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, input.perPage ?? DEFAULT_PER_PAGE),
  );
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  const url = new URL(`${UNSPLASH_API_BASE}/search/photos`);
  url.searchParams.set("query", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  // We always request landscape orientation for featured images —
  // hero crops on most blog templates expect a wide aspect ratio.
  // Future: expose this if/when the picker grows portrait/square modes.
  url.searchParams.set("orientation", "landscape");

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: {
        // Unsplash auth: `Client-ID <key>` (NOT bearer). The
        // Accept-Version header pins the API surface so a future
        // breaking change on Unsplash's side doesn't silently change
        // our payload shape.
        Authorization: `Client-ID ${accessKey}`,
        "Accept-Version": UNSPLASH_API_VERSION,
        Accept: "application/json",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "network_error";
    throw new UnsplashSearchError("unsplash_request_failed", message);
  }

  if (response.status === 429) {
    throw new UnsplashSearchError("rate_limited");
  }
  if (!response.ok) {
    let body = "";
    try {
      body = (await response.text()).slice(0, 500);
    } catch {
      // Body is optional context; if it's already been consumed
      // we just send the status text.
    }
    throw new UnsplashSearchError(
      "unsplash_request_failed",
      `${response.status} ${response.statusText}${body ? ` ${body}` : ""}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid_json";
    throw new UnsplashSearchError("unsplash_invalid_response", message);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new UnsplashSearchError(
      "unsplash_invalid_response",
      "expected object",
    );
  }
  const payload = parsed as RawUnsplashSearchResponse;
  if (!Array.isArray(payload.results)) {
    throw new UnsplashSearchError(
      "unsplash_invalid_response",
      "missing results array",
    );
  }

  const results: UnsplashSearchResult[] = [];
  for (const raw of payload.results) {
    const normalized = normalizePhoto(raw);
    if (normalized) results.push(normalized);
  }

  const totalResults = isPositiveInteger(payload.total) ? payload.total : 0;
  const totalPages = isPositiveInteger(payload.total_pages)
    ? payload.total_pages
    : 0;

  return { results, totalResults, totalPages };
}
