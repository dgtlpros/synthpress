/**
 * Slugify a free-form string into an ASCII-only, lowercase, hyphenated
 * token suitable for filenames, URL paths, and stable section keys.
 *
 * Behavior:
 *   - Lowercase
 *   - Replace any non-alphanumeric run with a single hyphen
 *   - Collapse runs of hyphens
 *   - Trim leading/trailing hyphens
 *   - Optionally cap at `maxLength` (after trimming, peeling a trailing
 *     hyphen if the cut lands mid-hyphen)
 *
 * ASCII-only is intentional — Postgres + WordPress + CDNs all accept
 * unicode in filenames, but many media pipelines mangle them, and we
 * want byte-stable output. Emoji / accented characters become
 * hyphens, which the trim/collapse passes then handle.
 *
 * Returns an empty string when the input has no slug-able characters
 * (e.g. only punctuation, only emoji). Callers decide what to fall
 * back to.
 *
 * Pure function — no side effects, easy to test in isolation.
 */

export interface SlugifyOptions {
  /**
   * Maximum length of the returned slug. The function caps AFTER
   * collapse/trim and re-trims if the cut lands on a hyphen, so you
   * never get a result ending in `-`. Pass `undefined` (the default)
   * for no cap.
   */
  maxLength?: number;
}

export function slugify(value: string, options: SlugifyOptions = {}): string {
  const slugged = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (
    options.maxLength === undefined ||
    slugged.length <= options.maxLength
  ) {
    return slugged;
  }
  // If the cut landed mid-hyphen, peel it off so we never end on
  // `-` (which would produce things like "modern-.jpg" downstream).
  return slugged.slice(0, options.maxLength).replace(/-$/, "");
}
