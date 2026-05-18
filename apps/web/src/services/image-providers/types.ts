/**
 * Image-provider adapter: shared types.
 *
 * One interface every external image source (Unsplash today, future
 * Pexels / OpenAI image gen / etc.) implements so the rest of the
 * codebase can search + download-track without knowing or caring
 * which provider produced a given result.
 *
 * Why an adapter:
 *   The article editor, autopilot scheduler, and WordPress publish
 *   path all need to interact with image search/tracking. Each
 *   provider has a different REST shape, different response keys,
 *   different rate-limit headers, different download-tracking
 *   conventions (Unsplash requires a GET to a tracking URL on use,
 *   most others don't, AI providers have no concept). The adapter
 *   normalises this so the application layer is provider-agnostic.
 *
 * What this file is NOT:
 *   - The Unsplash implementation lives in `unsplash-provider.ts`
 *     and wraps the existing `unsplash-service.ts` (search) +
 *     `unsplash-download-service.ts` (tracking) helpers without
 *     replacing them.
 *   - The lookup helper lives in `registry.ts`.
 *
 * Type-only — no runtime side-effects. Safe to import from anywhere.
 */

/**
 * String-literal union of known providers, plus an open-ended
 * `string` escape hatch so a future provider can be added without
 * touching every consumer's type signatures. Existing call sites
 * that switch on the provider only need to handle the unions they
 * care about.
 */
export type ImageProviderId = "unsplash" | (string & {});

/**
 * Normalized search result. Picker UI + connector +
 * `article_image_uploads` row all read from this shape.
 *
 * Nullable everywhere a provider might not have the data:
 *   - `description` / `altDescription` — Unsplash photos often have
 *     one but not both; AI-generated images would synthesize one
 *     from the prompt.
 *   - `fullUrl` — only large enough providers expose a "full" size.
 *   - photographer fields — AI/user-uploaded images have no
 *     photographer to credit.
 *   - `downloadLocation` — Unsplash-specific tracking endpoint.
 *     Other providers leave it null and `trackDownload` no-ops.
 */
export interface NormalizedImageSearchResult {
  /** Which provider produced this row. */
  provider: ImageProviderId;
  /** Provider-scoped photo id. Opaque, used for keys + dedup. */
  providerPhotoId: string;
  description: string | null;
  altDescription: string | null;
  /** Small thumbnail URL (~200px wide). Picker grid uses this. */
  thumbUrl: string;
  /** Hero-ready URL (~1080px). What we save into `featured_image_url`. */
  regularUrl: string;
  /** Largest URL the provider exposes. Optional — most consumers don't need it. */
  fullUrl?: string | null;
  photographerName?: string | null;
  photographerProfileUrl?: string | null;
  /** Direct URL to the photo on the provider's site. */
  photoUrl?: string | null;
  /** Provider-specific tracking endpoint. See `trackDownload`. */
  downloadLocation?: string | null;
}

export interface ImageSearchInput {
  query: string;
  /** 1-indexed page number. Provider-specific cap. */
  page?: number;
  /** Per-page count. Provider-specific cap. */
  perPage?: number;
  /**
   * Allow tests to override `globalThis.fetch`. Kept on the input
   * (rather than the provider constructor) so a single shared
   * provider singleton can still be unit-tested with a fake fetch.
   */
  fetchImpl?: typeof fetch;
}

export interface ImageSearchResponse {
  results: NormalizedImageSearchResult[];
  totalResults?: number;
  totalPages?: number;
}

export interface TrackImageDownloadInput {
  /**
   * Provider-specific tracking endpoint. Stored verbatim on
   * `article_image_uploads.download_location`. May be null/undefined
   * if the row pre-dates this column or if the provider has no
   * tracking concept — adapters MUST short-circuit safely in that
   * case (no throw, no network call).
   */
  downloadLocation?: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * Generic error codes shared across providers. Maps 1:1 to
 * `IMAGE_SEARCH_ERROR_COPY` for friendly UI strings.
 *
 *   - `query_required`        — empty/whitespace query
 *   - `missing_access_key`    — provider env var missing
 *   - `rate_limited`          — 429 from the provider
 *   - `request_failed`        — network error or non-2xx (excluding 429)
 *   - `invalid_response`      — couldn't parse provider payload
 *   - `unsupported_provider`  — registry lookup miss
 */
export type ImageSearchErrorCode =
  | "query_required"
  | "missing_access_key"
  | "rate_limited"
  | "request_failed"
  | "invalid_response"
  | "unsupported_provider";

export class ImageSearchError extends Error {
  readonly code: ImageSearchErrorCode;
  readonly providerId: ImageProviderId | null;
  readonly details?: string;

  constructor(
    code: ImageSearchErrorCode,
    options: {
      providerId?: ImageProviderId | null;
      details?: string;
    } = {},
  ) {
    super(
      `image_search_error:${code}${options.details ? `:${options.details}` : ""}`,
    );
    this.name = "ImageSearchError";
    this.code = code;
    this.providerId = options.providerId ?? null;
    this.details = options.details;
  }
}

/**
 * The adapter contract. Every provider exposes the same `searchImages`
 * shape so the action/hook/picker stay provider-agnostic.
 *
 * `trackDownload` is required on the interface so the WordPress
 * post-upload bookkeeping can call it unconditionally without a
 * registry-side null check. Providers without a tracking concept
 * (most of them) MUST implement it as a safe no-op resolving to
 * `{ tracked: false, reason: "not_supported" }` rather than
 * throwing — bookkeeping is best-effort and must never fail the
 * publish.
 */
export interface ImageSearchProvider {
  readonly providerId: ImageProviderId;
  readonly displayName: string;
  searchImages(input: ImageSearchInput): Promise<ImageSearchResponse>;
  trackDownload(
    input: TrackImageDownloadInput,
  ): Promise<TrackImageDownloadResult>;
}

export interface TrackImageDownloadResult {
  tracked: boolean;
  reason:
    | "sent"
    | "no_download_location"
    | "missing_access_key"
    | "request_failed"
    | "non_2xx"
    | "not_supported";
}
