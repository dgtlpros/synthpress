import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { extractArticleSections } from "@/lib/extract-article-sections";

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
 *   each H2 whose slugified key matches a map entry. The list of
 *   keys-in-document-order is computed once via
 *   {@link extractArticleSections}; the renderer increments a local
 *   counter as it sees each H2 to know which key it's on. That
 *   counter resets per render (it's a `let` inside the component
 *   function), so React Strict Mode's double-render also produces
 *   correct output.
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
  // Pre-extract the H2 keys in document order so the H2 renderer
  // can look them up by index. Memoized on `markdown` to avoid
  // re-parsing per parent re-render when the body hasn't changed.
  const orderedSectionKeys = useMemo(() => {
    if (!sectionImagesByKey || Object.keys(sectionImagesByKey).length === 0) {
      return [];
    }
    return extractArticleSections(markdown).map((s) => s.sectionKey);
  }, [markdown, sectionImagesByKey]);

  // Counter wrapper for the H2 renderer. Wrapped in an object so
  // the renderer can mutate `.value` per H2 it sees without
  // tripping the "no let reassignment after render" lint rule.
  // Fresh per render → strict-mode double-renders each get their
  // own counter + produce identical output.
  const h2Counter = { value: 0 };

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
          h2: ({ children }) => {
            // Look up the section image by this H2's document
            // index. The list is empty when no section images were
            // supplied, so this short-circuits to the plain H2.
            const key = orderedSectionKeys[h2Counter.value];
            h2Counter.value += 1;
            const image = key ? sectionImagesByKey?.[key] : undefined;
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
function SectionImageBlock({
  image,
}: {
  image: MarkdownPreviewSectionImage;
}) {
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
  const providerLabel =
    attribution.provider === "unsplash" ? "Unsplash" : attribution.provider;
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
