import "server-only";

import {
  searchUnsplashPhotos,
  UnsplashSearchError,
  type UnsplashSearchResult,
} from "../unsplash-service";
import { triggerUnsplashDownload } from "../unsplash-download-service";
import {
  ImageSearchError,
  type ImageProviderId,
  type ImageSearchInput,
  type ImageSearchProvider,
  type ImageSearchResponse,
  type NormalizedImageSearchResult,
  type TrackImageDownloadInput,
  type TrackImageDownloadResult,
  type ImageSearchErrorCode,
} from "./types";

/**
 * Unsplash adapter for the generic `ImageSearchProvider` interface.
 *
 * Wraps the existing `unsplash-service` (search) and
 * `unsplash-download-service` (tracking) helpers without replacing
 * them — those modules remain the source of truth for Unsplash REST
 * shape, env-var name, rate-limit handling, and download-tracking
 * URL semantics. This adapter just normalises the result + error
 * shapes to the provider-agnostic types consumed by the action /
 * hook / picker / WordPress publish path.
 *
 * Why a separate file:
 *   - Keeps the Unsplash REST mapping logic in `unsplash-service.ts`
 *     (testable in isolation without provider abstractions).
 *   - Keeps `types.ts` import-light so the public adapter types can
 *     be consumed from client code without dragging `server-only`
 *     into the bundle.
 *   - Future providers (Pexels, AI image gen) get their own sibling
 *     `*-provider.ts` file and register in `registry.ts` — no
 *     changes here.
 */

export const UNSPLASH_PROVIDER_ID: ImageProviderId = "unsplash";

/**
 * Maps Unsplash-specific error codes to the generic
 * `ImageSearchErrorCode` union. Two of Unsplash's codes are
 * provider-prefixed (`unsplash_request_failed`,
 * `unsplash_invalid_response`); collapse those onto the generic
 * names so the friendly-copy lookup doesn't need to know about
 * provider naming conventions.
 */
function mapUnsplashErrorCode(
  code: UnsplashSearchError["code"],
): ImageSearchErrorCode {
  switch (code) {
    case "unsplash_request_failed":
      return "request_failed";
    case "unsplash_invalid_response":
      return "invalid_response";
    case "query_required":
    case "missing_access_key":
    case "rate_limited":
      return code;
    /* v8 ignore start -- defensive: if Unsplash adds a new code we haven't mapped, surface it as a generic request_failed rather than throwing. The TypeScript union is exhaustive today; this branch is provably unreachable until that union grows. */
    default:
      // The cast asserts exhaustiveness — if Unsplash adds a new
      // code, TypeScript flags this line at compile time.
      void (code satisfies never);
      return "request_failed";
    /* v8 ignore stop */
  }
}

/**
 * Normalises a single Unsplash result into the provider-agnostic
 * shape. Unsplash already gives us non-null defaults for the
 * photographer fields (its `normalizePhoto` helper falls back to
 * `"Unsplash photographer"` etc.), but we widen the type to
 * nullable here so future adapters can be more honest about
 * missing data.
 */
function normalizeUnsplashResult(
  raw: UnsplashSearchResult,
): NormalizedImageSearchResult {
  return {
    provider: UNSPLASH_PROVIDER_ID,
    providerPhotoId: raw.id,
    description: raw.description,
    altDescription: raw.altDescription,
    thumbUrl: raw.thumbUrl,
    regularUrl: raw.regularUrl,
    fullUrl: raw.fullUrl ?? null,
    photographerName: raw.photographerName,
    photographerProfileUrl: raw.photographerProfileUrl,
    photoUrl: raw.photoUrl,
    downloadLocation: raw.downloadLocation ?? null,
  };
}

export const unsplashProvider: ImageSearchProvider = {
  providerId: UNSPLASH_PROVIDER_ID,
  displayName: "Unsplash",

  async searchImages(input: ImageSearchInput): Promise<ImageSearchResponse> {
    try {
      const raw = await searchUnsplashPhotos({
        query: input.query,
        page: input.page,
        perPage: input.perPage,
        fetchImpl: input.fetchImpl,
      });
      return {
        results: raw.results.map(normalizeUnsplashResult),
        totalResults: raw.totalResults,
        totalPages: raw.totalPages,
      };
    } catch (err) {
      // Re-wrap UnsplashSearchError as ImageSearchError so the
      // action layer can do a single `instanceof ImageSearchError`
      // check regardless of provider.
      if (err instanceof UnsplashSearchError) {
        throw new ImageSearchError(mapUnsplashErrorCode(err.code), {
          providerId: UNSPLASH_PROVIDER_ID,
          details: err.details,
        });
      }
      throw err;
    }
  },

  async trackDownload(
    input: TrackImageDownloadInput,
  ): Promise<TrackImageDownloadResult> {
    // Defer to the existing best-effort helper. It already returns
    // typed reasons + never throws — we just rename `success` →
    // `tracked` so the field reads naturally on the generic type.
    const result = await triggerUnsplashDownload({
      downloadLocation: input.downloadLocation,
      fetchImpl: input.fetchImpl,
    });
    return { tracked: result.success, reason: result.reason };
  },
};
