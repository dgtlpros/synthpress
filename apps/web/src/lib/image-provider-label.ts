/**
 * Friendly display label for an `ImageProviderId`.
 *
 * Used by every surface that renders attribution credit (picker
 * thumbnails, MarkdownPreview section-image figcaption, ArticleDetail
 * featured-image credit line, WordPress published HTML).
 *
 * Why it's a `lib/` module (not a service / not type-only):
 *   The renderers live in client + server bundles. Keeping the
 *   mapping here (with no `server-only` import) means the Markdown
 *   preview can label a Pexels image "Pexels" without dragging the
 *   server-side provider registry into the client bundle.
 *
 * Resolution:
 *   * `'pexels'`   → `'Pexels'`   (active)
 *   * `'unsplash'` → `'Unsplash'` (legacy attribution rows still
 *                    render the historic label so an existing
 *                    `<figcaption>` keeps reading correctly)
 *   * Anything else (future / manual_url / unknown) falls through
 *     to the raw provider id. That's intentional: a malformed row
 *     surfaces as "Photo by X on <provider-id>" which is ugly but
 *     legible — better than a generic "from the image library"
 *     that hides bad data.
 */
const PROVIDER_DISPLAY_LABELS: Record<string, string> = {
  pexels: "Pexels",
  unsplash: "Unsplash",
};

export function providerDisplayLabel(
  provider: string | null | undefined,
): string {
  if (typeof provider !== "string" || !provider) return "";
  return PROVIDER_DISPLAY_LABELS[provider] ?? provider;
}
