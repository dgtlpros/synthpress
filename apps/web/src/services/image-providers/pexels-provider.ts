import "server-only";

import {
  ImageSearchError,
  type ImageProviderId,
  type ImageSearchInput,
  type ImageSearchProvider,
  type ImageSearchResponse,
  type NormalizedImageSearchResult,
  type TrackImageDownloadInput,
  type TrackImageDownloadResult,
} from "./types";

/**
 * Pexels adapter for the generic `ImageSearchProvider` interface.
 *
 * Pexels is the active image provider for SynthPress. The picker +
 * autopilot's automatic featured / section image selection both
 * route through this adapter (via the registry). Unsplash remains
 * registered as a legacy adapter so historical
 * `article_image_uploads` rows whose `provider='unsplash'` still
 * resolve through `getImageProvider('unsplash')` — but new picks
 * always come from here.
 *
 * Why this lives in one file (no `pexels-service.ts` sibling like
 * Unsplash):
 *   * Pexels has no download-tracking concept — the public
 *     `trackDownload` is a deliberate no-op (see
 *     {@link ImageSearchProvider.trackDownload} for the contract:
 *     "no throw, no network call" for providers without tracking).
 *   * The REST surface we use is a single endpoint
 *     (`GET /v1/search`). Splitting search + adapter the way
 *     Unsplash does buys nothing for a single endpoint.
 *   * Smaller surface to audit + a faster import graph for the
 *     server bundle.
 *
 * Auth header:
 *   Pexels expects the bare key in `Authorization`, NOT
 *   `Bearer <key>`. (Unsplash uses `Client-ID <key>` — both are
 *   different from each other and from RFC 6750 bearer auth.)
 *   See https://www.pexels.com/api/documentation/.
 *
 * Orientation:
 *   Hard-coded to `landscape` so featured + section crops on most
 *   blog templates land on a wide aspect ratio. Mirrors the
 *   Unsplash adapter's posture; the picker UI can grow a
 *   portrait/square mode later if needed.
 */

export const PEXELS_PROVIDER_ID: ImageProviderId = "pexels";

const PEXELS_API_BASE = "https://api.pexels.com/v1";
const DEFAULT_PER_PAGE = 12;
// Pexels caps at 80 per page; we cap lower because anything above
// the autopilot's diversity window (15) is wasted bandwidth on the
// client picker and the autopilot retries through smaller pages.
const MAX_PER_PAGE = 80;

interface RawPexelsPhotoSrc {
  original?: string | null;
  large2x?: string | null;
  large?: string | null;
  medium?: string | null;
  small?: string | null;
  portrait?: string | null;
  landscape?: string | null;
  tiny?: string | null;
}

interface RawPexelsPhoto {
  id?: number | string;
  url?: string | null;
  alt?: string | null;
  photographer?: string | null;
  photographer_url?: string | null;
  photographer_id?: number | string | null;
  src?: RawPexelsPhotoSrc | null;
}

interface RawPexelsSearchResponse {
  page?: unknown;
  per_page?: unknown;
  photos?: unknown;
  total_results?: unknown;
  next_page?: unknown;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Maps one raw Pexels photo into our normalized shape, or returns
 * `null` when the row is missing fields the picker actually needs
 * (`id` + a usable thumb + a usable regular URL). Filtering instead
 * of throwing keeps a single bad row from sinking an otherwise-valid
 * search response — same posture as the Unsplash normalizer.
 *
 * URL fallbacks (in priority order):
 *   * `thumbUrl`    — `src.medium` → `src.small` → `src.tiny`.
 *   * `regularUrl`  — `src.large` → `src.large2x` → `src.original`.
 *     Pexels' `large` is ~940×650 (close to Unsplash's `regular`),
 *     `large2x` is ~1880×1300, and `original` is the source bytes.
 *   * `fullUrl`     — `src.original`.
 *
 * Pexels returns numeric `id`s; we coerce to string for the
 * provider-agnostic `providerPhotoId` (matches the column type +
 * Unsplash's already-string ids).
 */
function normalizePexelsResult(
  raw: RawPexelsPhoto,
): NormalizedImageSearchResult | null {
  const idValue = raw.id;
  const id =
    typeof idValue === "number" || typeof idValue === "string"
      ? String(idValue).trim()
      : "";
  if (!id) return null;

  const src = raw.src ?? {};
  const thumbUrl =
    (typeof src.medium === "string" && src.medium) ||
    (typeof src.small === "string" && src.small) ||
    (typeof src.tiny === "string" && src.tiny) ||
    null;
  const regularUrl =
    (typeof src.large === "string" && src.large) ||
    (typeof src.large2x === "string" && src.large2x) ||
    (typeof src.original === "string" && src.original) ||
    null;
  if (!thumbUrl || !regularUrl) return null;

  const fullUrl =
    typeof src.original === "string" && src.original ? src.original : null;
  const altRaw = typeof raw.alt === "string" ? raw.alt.trim() : "";
  const alt = altRaw.length > 0 ? altRaw : null;
  const photographerName =
    typeof raw.photographer === "string" && raw.photographer.trim()
      ? raw.photographer.trim()
      : null;
  const photographerProfileUrl =
    typeof raw.photographer_url === "string" && raw.photographer_url
      ? raw.photographer_url
      : null;
  const photoUrl = typeof raw.url === "string" && raw.url ? raw.url : null;

  return {
    provider: PEXELS_PROVIDER_ID,
    providerPhotoId: id,
    description: alt,
    altDescription: alt,
    thumbUrl,
    regularUrl,
    fullUrl,
    photographerName,
    photographerProfileUrl,
    photoUrl,
    // Pexels has no per-photo tracking endpoint. Always null so the
    // WP publish path skips `trackDownload` for these rows.
    downloadLocation: null,
  };
}

/**
 * Pexels search. Throws `ImageSearchError` for every failure mode
 * so the action layer's `instanceof ImageSearchError` branch can
 * map them to friendly UI copy through `IMAGE_SEARCH_ERROR_COPY`.
 *
 * Status-code mapping:
 *   * 401 / 403 → `request_failed` (with the status text in
 *     `details`). We deliberately don't emit `missing_access_key`
 *     for these because the env var is set; it's just invalid /
 *     revoked. The same friendly copy ("Couldn't reach the image
 *     provider") covers both transient and auth failures here.
 *   * 429 → `rate_limited`.
 *   * Other non-2xx → `request_failed` with the status + body.
 *   * Network / fetch throw → `request_failed` with the message.
 *   * Non-JSON / unexpected payload → `invalid_response`.
 */
async function searchPexels(
  input: ImageSearchInput & { accessKey?: string },
): Promise<ImageSearchResponse> {
  const query = input.query.trim();
  if (!query) {
    throw new ImageSearchError("query_required", {
      providerId: PEXELS_PROVIDER_ID,
    });
  }

  const accessKey = input.accessKey ?? process.env.PEXELS_API_KEY ?? "";
  if (!accessKey) {
    throw new ImageSearchError("missing_access_key", {
      providerId: PEXELS_PROVIDER_ID,
    });
  }

  const page = Math.max(1, input.page ?? 1);
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, input.perPage ?? DEFAULT_PER_PAGE),
  );
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  const url = new URL(`${PEXELS_API_BASE}/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orientation", "landscape");

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: {
        // Pexels: bare API key (NOT `Bearer <key>` / `Client-ID <key>`).
        Authorization: accessKey,
        Accept: "application/json",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "network_error";
    throw new ImageSearchError("request_failed", {
      providerId: PEXELS_PROVIDER_ID,
      details: message,
    });
  }

  if (response.status === 429) {
    throw new ImageSearchError("rate_limited", {
      providerId: PEXELS_PROVIDER_ID,
    });
  }
  if (!response.ok) {
    let body = "";
    try {
      body = (await response.text()).slice(0, 500);
      /* v8 ignore start -- defensive: response.text() failure is a fetch impl bug; we still surface a typed error so the caller doesn't see a raw throw */
    } catch {
      // Best-effort body read; status alone is enough to surface
      // a typed error.
    }
    /* v8 ignore stop */
    throw new ImageSearchError("request_failed", {
      providerId: PEXELS_PROVIDER_ID,
      details: `${response.status} ${response.statusText}${body ? ` ${body}` : ""}`,
    });
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid_json";
    throw new ImageSearchError("invalid_response", {
      providerId: PEXELS_PROVIDER_ID,
      details: message,
    });
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ImageSearchError("invalid_response", {
      providerId: PEXELS_PROVIDER_ID,
      details: "expected object",
    });
  }
  const payload = parsed as RawPexelsSearchResponse;
  if (!Array.isArray(payload.photos)) {
    throw new ImageSearchError("invalid_response", {
      providerId: PEXELS_PROVIDER_ID,
      details: "missing photos array",
    });
  }

  const results: NormalizedImageSearchResult[] = [];
  for (const raw of payload.photos) {
    if (typeof raw !== "object" || raw === null) continue;
    const normalized = normalizePexelsResult(raw as RawPexelsPhoto);
    if (normalized) results.push(normalized);
  }

  const totalResults = isPositiveInteger(payload.total_results)
    ? payload.total_results
    : undefined;
  // Pexels doesn't surface a `total_pages` integer (only `next_page`
  // URL). We omit `totalPages` rather than fabricate one — the
  // picker only uses `totalResults` for the "Showing N of M" hint.
  return {
    results,
    totalResults,
  };
}

export const pexelsProvider: ImageSearchProvider = {
  providerId: PEXELS_PROVIDER_ID,
  displayName: "Pexels",

  async searchImages(input: ImageSearchInput): Promise<ImageSearchResponse> {
    return searchPexels(input);
  },

  /**
   * No-op tracker. Pexels has no equivalent to Unsplash's
   * `download_location` ping; their attribution guidelines are
   * satisfied by the `<figcaption>` credit + photographer link
   * surfaced in the picker / article detail / WordPress output.
   *
   * Returns `tracked: false, reason: "not_supported"` per the
   * adapter contract so the WordPress publish bookkeeping can
   * branch on `reason` if it ever wants to log "skipped vs
   * actually-sent" separately.
   */
  async trackDownload(
    _input: TrackImageDownloadInput,
  ): Promise<TrackImageDownloadResult> {
    void _input;
    return { tracked: false, reason: "not_supported" };
  },
};
