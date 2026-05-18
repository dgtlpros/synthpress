import { slugify } from "./slugify";

/**
 * Builds an SEO-friendly filename for the WordPress media upload's
 * `Content-Disposition` header.
 *
 * Why this matters:
 *   WordPress stores the uploaded filename verbatim, derives the media
 *   library slug from it, and surfaces it in the `<img src>` URL. A
 *   remote source URL like `photo-1517245386807-bb43f82c33c4.jpg`
 *   (typical Unsplash CDN filename) is opaque; an SEO-aware filename
 *   like `modern-video-doorbell-on-front-porch.jpg` is what every SEO
 *   playbook recommends.
 *
 * Source-of-truth priority (first non-blank wins as the BASE):
 *   1. `featuredImageAlt` — closest to "what the image is" + already
 *      written for screen readers, so usually the best signal.
 *   2. `targetKeyword` — the keyword the article ranks for; second-best
 *      proxy for "what the image is in context".
 *   3. `articleTitle` — last because article titles tend to be longer
 *      and more brand-y ("How to launch a B2B blog in 30 days").
 *   4. `synthpress-featured-image` — generic fallback when none of the
 *      above are set (rare; an article must have at least a title in
 *      practice).
 *
 * Extension priority:
 *   1. Mapped from `contentType` (`image/jpeg` → `jpg`).
 *   2. `fallbackExtension` if provided.
 *   3. `jpg` as the universally-accepted final fallback.
 *
 * Length cap: the base (sans extension) is hard-capped at 96 characters.
 * That's well under WordPress's 255-byte filename limit but also keeps
 * the resulting `<img src>` URL from blowing past common CDN path
 * limits and from looking ridiculous in the WP media library.
 *
 * Pure function — no side effects, easy to unit-test.
 */

export interface BuildFeaturedImageFilenameInput {
  /** Article title (`articles.title`). May be empty. */
  articleTitle?: string | null;
  /** Article target keyword (`articles.target_keyword`). May be empty. */
  targetKeyword?: string | null;
  /** Alt text from `articles.featured_image_alt`. May be empty. */
  featuredImageAlt?: string | null;
  /**
   * MIME type from the source image fetch (`image/jpeg`,
   * `image/png`, etc.). Used to pick the file extension.
   */
  contentType?: string | null;
  /**
   * Extension to use when `contentType` is missing or unrecognized.
   * Defaults to `jpg` so WordPress reliably accepts the upload.
   */
  fallbackExtension?: string;
}

/**
 * Maximum length of the slugified base (without the trailing extension).
 * Picked so a 96-char base + a 5-char extension stays well under
 * WordPress's 255-byte filename limit AND fits in a sensible URL slug.
 */
export const FEATURED_IMAGE_FILENAME_MAX_BASE_LENGTH = 96;

/** Universal fallback when no signal is available. */
export const FEATURED_IMAGE_FILENAME_FALLBACK_BASE =
  "synthpress-featured-image";

/**
 * Map of recognized image MIME types → the file extension we'd like
 * WordPress to see. Anything else falls through to the
 * `fallbackExtension` argument (default `jpg`).
 *
 * Limited to the four formats WordPress accepts by default; users can
 * upload others by enabling additional MIME types in WP, but v1 only
 * advertises these four in the picker UI + validation.
 */
const CONTENT_TYPE_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Slugifies an article-derived string into the filename base.
 * Thin wrapper around the shared {@link slugify} helper that pins
 * the length cap to the WordPress-friendly value.
 */
function slugifyBase(value: string): string {
  return slugify(value, {
    maxLength: FEATURED_IMAGE_FILENAME_MAX_BASE_LENGTH,
  });
}

/**
 * Picks the file extension from a content type. Returns the
 * `fallbackExtension` when content type is missing/unrecognized, or
 * `jpg` if no fallback was supplied. Always returns lowercase, no
 * leading dot.
 */
function pickExtension(
  contentType: string | null | undefined,
  fallbackExtension: string | undefined,
): string {
  if (typeof contentType === "string") {
    const normalized = contentType.split(";")[0]!.trim().toLowerCase();
    const mapped = CONTENT_TYPE_TO_EXTENSION[normalized];
    if (mapped) return mapped;
  }
  const cleanedFallback = fallbackExtension
    ?.trim()
    .toLowerCase()
    .replace(/^\./, "");
  if (cleanedFallback) return cleanedFallback;
  return "jpg";
}

/**
 * Tries each priority source in order until one slugifies to a
 * non-empty base, then appends the chosen extension.
 */
export function buildFeaturedImageFilename(
  input: BuildFeaturedImageFilenameInput,
): string {
  const candidates: Array<string | null | undefined> = [
    input.featuredImageAlt,
    input.targetKeyword,
    input.articleTitle,
  ];

  let base = "";
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const slugged = slugifyBase(trimmed);
    if (slugged) {
      base = slugged;
      break;
    }
  }
  if (!base) base = FEATURED_IMAGE_FILENAME_FALLBACK_BASE;

  const extension = pickExtension(input.contentType, input.fallbackExtension);
  return `${base}.${extension}`;
}
