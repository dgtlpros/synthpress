import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { extractArticleSections } from "@/lib/extract-article-sections";
import { providerDisplayLabel } from "@/lib/image-provider-label";

/**
 * Renders Markdown as styled HTML.
 *
 * Why hand-styled component overrides instead of `@tailwindcss/typography`:
 *   * Avoids adding another Tailwind plugin to the project for one
 *     surface that needs ~10 element types.
 *   * Keeps every link rendered with the brand colour + the safe
 *     `target="_blank" rel="noopener noreferrer"` triple — easier to
 *     audit than overriding a typography preset.
 *
 * `remark-gfm` adds GitHub-flavoured Markdown support (tables, task
 * lists, strikethrough, autolinks) which is what Claude tends to
 * produce for article bodies.
 *
 * Section images (optional):
 *   When `sectionImagesByKey` is supplied, the custom `h2` renderer
 *   injects an `<img>` block (plus optional attribution credit) ABOVE
 *   each H2 whose slugified key matches a map entry. We match each
 *   rendered `<h2>` to its image by its **source offset** —
 *   {@link extractArticleSections} stamps `startOffset` from the
 *   mdast `position.start.offset`, and react-markdown forwards the
 *   same offset on `node.position.start.offset` of the hast node
 *   passed to the override (remark-rehype carries positions through
 *   verbatim). A position-based join is purely functional with no
 *   per-render state, so it stays correct under React's StrictMode
 *   double-invoke (which a previous index-counter implementation
 *   broke — the second pass kept incrementing a shared counter,
 *   skipping past the trailing entries and leaving late sections
 *   imageless + producing a hydration mismatch against the SSR pass).
 */

/**
 * Provider attribution for a section image. Mirrors
 * `ArticleFeaturedImageAttribution` field-for-field so featured
 * + section attribution can share a single render helper later if
 * we extract it. Kept inline here so `MarkdownPreview` doesn't
 * depend on an organism.
 */
export interface MarkdownPreviewImageAttribution {
  provider: string;
  photographerName: string | null;
  photographerProfileUrl: string | null;
  photoUrl: string | null;
}

export interface MarkdownPreviewSectionImage {
  imageUrl: string;
  altText: string | null;
  attribution: MarkdownPreviewImageAttribution | null;
}

export interface MarkdownPreviewProps {
  markdown: string;
  /**
   * Optional map of `section_key` → image to render above the
   * matching H2. Keys come from
   * {@link extractArticleSections}'s `sectionKey` field — keep
   * source-of-truth alignment between the editor (which writes
   * with this key) and the renderer (which reads with it).
   *
   * Entries whose key doesn't appear in the parsed body are
   * silently ignored — they won't render anywhere. That's the
   * "orphaned section image" handling: the row may still exist
   * in `article_image_uploads`, but if the H2 was removed from
   * the body, it doesn't render.
   */
  sectionImagesByKey?: Record<string, MarkdownPreviewSectionImage>;
  className?: string;
}

export function MarkdownPreview({
  markdown,
  sectionImagesByKey,
  className,
}: MarkdownPreviewProps) {
  // Pre-build a `Map<sourceOffset, image>` so the H2 renderer can
  // join its hast node back to the correct row in pure (no per-
  // render counter) lookup. Memoized on `markdown` +
  // `sectionImagesByKey`; rebuilds when either changes.
  //
  // Empty/undefined map short-circuits to an empty Map so the H2
  // override degrades to a plain `<h2>` render without touching the
  // parser at all (saves a remark-parse pass on legacy articles
  // that have no section picks).
  const imagesByOffset = useMemo(() => {
    const out = new Map<number, MarkdownPreviewSectionImage>();
    if (!sectionImagesByKey || Object.keys(sectionImagesByKey).length === 0) {
      return out;
    }
    for (const section of extractArticleSections(markdown)) {
      /* v8 ignore next 1 -- defensive: extractArticleSections always stamps a numeric `startOffset` on real string input (remark-parse always populates `position.start.offset`); the `null` branch is an unreachable forward-compat guard */
      if (section.startOffset === null) continue;
      const image = sectionImagesByKey[section.sectionKey];
      if (image) out.set(section.startOffset, image);
    }
    return out;
  }, [markdown, sectionImagesByKey]);

  return (
    <div className={cn("text-sm text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-6 mb-3 text-2xl font-bold text-foreground first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ node, children }) => {
            // Look up the section image by this H2's source offset.
            // `node.position.start.offset` is the same UTF-16 index
            // remark-parse stamps on the mdast heading node;
            // remark-rehype copies it onto the hast node verbatim,
            // so the join lines up 1:1 with `extractArticleSections`'s
            // `startOffset` (computed off the same parser).
            const offset = node?.position?.start?.offset;
            /* v8 ignore start -- defensive: react-markdown 10 always passes `node.position.start.offset` as a number for hast nodes derived from string input (remark-rehype copies the value verbatim from mdast); the `undefined` branch only fires for nodes without source positions, which can't happen in production */
            const image =
              typeof offset === "number"
                ? imagesByOffset.get(offset)
                : undefined;
            /* v8 ignore stop */
            return (
              <>
                {image ? <SectionImageBlock image={image} /> : null}
                <h2 className="mt-6 mb-2 text-xl font-semibold text-foreground first:mt-0">
                  {children}
                </h2>
              </>
            );
          },
          h3: ({ children }) => (
            <h3 className="mt-4 mb-2 text-lg font-semibold text-foreground first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="my-3 leading-relaxed text-foreground first:mt-0 last:mb-0">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="my-3 list-disc space-y-1 pl-6 marker:text-muted">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 list-decimal space-y-1 pl-6 marker:text-muted">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-blue underline-offset-2 hover:underline"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-border pl-4 text-muted italic">
              {children}
            </blockquote>
          ),
          code: ({ children, className: codeClassName }) => {
            const isBlock = Boolean(codeClassName);
            return isBlock ? (
              <code
                className={cn(
                  "block whitespace-pre-wrap font-mono text-xs",
                  codeClassName,
                )}
              >
                {children}
              </code>
            ) : (
              <code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-xs">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-[var(--sp-radius-md)] bg-surface-hover p-3">
              {children}
            </pre>
          ),
          hr: () => <hr className="my-6 border-border" />,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border bg-surface-hover px-3 py-2 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border px-3 py-2">{children}</td>
          ),
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element -- markdown images come from arbitrary external sources, next/image's domain allowlist would block them
            <img
              src={src as string}
              /* v8 ignore next -- react-markdown always passes a string alt (empty when omitted), so the ?? "" fallback is unreachable from real input */
              alt={alt ?? ""}
              className="my-3 max-w-full rounded-[var(--sp-radius-md)]"
            />
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Renders the section-image figure above an H2.
 *
 * Wrapped in a `<figure>` so the attribution `<figcaption>` is
 * semantically associated with the image for screen readers.
 * Margins mirror the H1/H2 spacing so the figure sits naturally
 * between the previous section's body and the next heading.
 */
function SectionImageBlock({ image }: { image: MarkdownPreviewSectionImage }) {
  const credit = renderAttribution(image.attribution);
  return (
    <figure className="mt-6 mb-2 first:mt-0">
      {/* eslint-disable-next-line @next/next/no-img-element -- third-party
          URL; next/image's domain allowlist would block Unsplash + future
          providers */}
      <img
        src={image.imageUrl}
        alt={image.altText ?? ""}
        className="w-full rounded-[var(--sp-radius-md)]"
      />
      {credit ? (
        <figcaption className="mt-2 text-xs text-muted">{credit}</figcaption>
      ) : null}
    </figure>
  );
}

/**
 * Builds the "Photo by X on Provider" credit line for a section
 * image. Returns `null` when there's nothing meaningful to render
 * (manual-paste rows with no photographer + no link). The shape
 * mirrors `FeaturedImageAttributionLine` in `ArticleDetail` so the
 * two surfaces produce visually-consistent credit text.
 */
function renderAttribution(
  attribution: MarkdownPreviewImageAttribution | null,
): React.ReactNode {
  if (!attribution) return null;
  // Provider label resolves: 'pexels' → 'Pexels' (active),
  // 'unsplash' → 'Unsplash' (legacy historical rows continue
  // rendering correctly), anything else → raw id (forward-compat
  // for future providers without a code change here).
  /* v8 ignore start -- defensive: providerDisplayLabel only returns "" for empty/null/non-string input, but `attribution.provider` is typed `string` and required; the `|| attribution.provider` fallback guards against a malformed jsonb row leaking through but is unreachable from the typed call path */
  const providerLabel =
    providerDisplayLabel(attribution.provider) || attribution.provider;
  /* v8 ignore stop */
  const photographerName = attribution.photographerName?.trim() || null;
  // Manual-paste rows with no photographer + no link have nothing
  // to credit; skip the figcaption entirely.
  if (!photographerName && !attribution.photoUrl) return null;

  const photographerNode =
    photographerName && attribution.photographerProfileUrl ? (
      <a
        href={attribution.photographerProfileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground underline-offset-2 hover:underline"
      >
        {photographerName}
      </a>
    ) : photographerName ? (
      <span className="text-foreground">{photographerName}</span>
    ) : null;

  const providerNode = attribution.photoUrl ? (
    <a
      href={attribution.photoUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-foreground underline-offset-2 hover:underline"
    >
      {providerLabel}
    </a>
  ) : (
    <span className="text-foreground">{providerLabel}</span>
  );

  return (
    <>
      {photographerNode ? <>Photo by {photographerNode} on </> : <>From </>}
      {providerNode}
    </>
  );
}
