import "server-only";

import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { extractArticleSections } from "./extract-article-sections";
import { providerDisplayLabel } from "./image-provider-label";

/**
 * Server-side Markdown → HTML conversion used by the publishing
 * pipeline (today: WordPress draft creation; tomorrow: any other CMS
 * that takes raw HTML).
 *
 * Why this lives in `lib/` and is server-only:
 *   * The browser view of an article uses `<MarkdownPreview>`, a
 *     client React component that renders Markdown straight to React
 *     nodes via `react-markdown`. That component never produces an
 *     HTML *string*, so it can't double as the publish payload.
 *   * Conversion has to happen on the server so the Markdown body
 *     never leaks raw to a remote CMS without a sanitizer pass — the
 *     publisher and the sanitizer must run inside the same trust
 *     boundary.
 *
 * Pipeline:
 *   remark-parse   → Markdown text to mdast
 *   remark-gfm     → tables, task lists, strikethrough, autolinks
 *                    (matches what `MarkdownPreview` renders so the
 *                    "preview" and the "published" output stay
 *                    consistent)
 *   remark-rehype  → mdast to hast (HTML AST). `allowDangerousHtml`
 *                    is left at its default (false) so any inline
 *                    raw HTML the AI / user typed is silently
 *                    dropped before it ever reaches the sanitizer.
 *                    That's the strictest possible posture for a v1
 *                    that publishes to a remote site.
 *   rehype-sanitize → strip anything outside the safe allowlist
 *                    (script, style, iframe, on*=, javascript:, etc.)
 *   rehype-stringify → hast back to an HTML string the WordPress
 *                    REST API will accept verbatim.
 *
 * `articles.content_markdown` stays the source of truth — we never
 * persist the generated HTML on `articles.content`. (That column
 * still exists from the legacy schema; it would be a separate
 * migration to retire it cleanly.)
 */

/**
 * Restricted allowlist on top of `rehype-sanitize`'s GitHub-flavoured
 * default. We start from `defaultSchema` (which already strips script,
 * style, on* handlers, and javascript: URLs) and tighten it for blog
 * publishing:
 *   * Drop `<input>` (sanitize defaults allow it for task list
 *     checkboxes; we don't want raw form controls in published
 *     content).
 *   * Restrict allowed link / image protocols to http/https/mailto so
 *     a malformed Markdown can't smuggle a `data:` payload through.
 */
function buildSanitizeSchema() {
  // defaultSchema in hast-util-sanitize always defines tagNames and
  // protocols at runtime; the `??` fallbacks are defensive in case a
  // future version drops them.
  /* v8 ignore next */
  const tagNames = (defaultSchema.tagNames ?? []).filter((t) => t !== "input");
  /* v8 ignore next */
  const baseProtocols = defaultSchema.protocols ?? {};
  return {
    ...defaultSchema,
    tagNames,
    protocols: {
      ...baseProtocols,
      href: ["http", "https", "mailto"],
      src: ["http", "https"],
    },
  };
}

const SANITIZE_SCHEMA = buildSanitizeSchema();

const BASE_PROCESSOR = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize, SANITIZE_SCHEMA)
  .use(rehypeStringify);

/**
 * Section-image payload for the WordPress publish pipeline. One
 * entry per H2 the user has attached an image to. `imageUrl` should
 * be the WordPress media `source_url` when available (post-upload)
 * so the published post links to the WP-hosted asset; falls back to
 * the original `image_url` when the section row hasn't been
 * uploaded yet (shouldn't happen in the normal publish flow since
 * `ensureSectionMediaUploaded` runs first).
 *
 * `wpMediaId` (optional) is appended as a `wp-image-{id}` class on
 * the rendered `<img>` so WordPress styles + the media library
 * "this image is used in this post" linkage both work.
 *
 * `attribution` (optional) renders a `<figcaption>` underneath the
 * image with provider credit. Mirrors the
 * `MarkdownPreviewImageAttribution` shape the read-view uses so a
 * future refactor can share one rendering helper.
 */
export interface SectionImageForHtml {
  imageUrl: string;
  altText: string | null;
  wpMediaId?: number | null;
  attribution?: SectionImageAttributionForHtml | null;
}

export interface SectionImageAttributionForHtml {
  provider: string;
  photographerName: string | null;
  photographerProfileUrl: string | null;
  photoUrl: string | null;
}

export interface MarkdownToHtmlOptions {
  /**
   * Map of `section_key` → image to inject above the matching H2 in
   * the rendered HTML. Keys come from
   * `extractArticleSections(markdown)`'s `sectionKey` field so the
   * markdown + section-image data agree on which key belongs to
   * which heading. Entries whose key doesn't appear in the parsed
   * body are silently ignored (orphans — heading was removed but
   * the section row still exists).
   *
   * `undefined` or empty map → plain markdown → HTML, identical to
   * the v5 publish behavior.
   */
  sectionImagesByKey?: Record<string, SectionImageForHtml>;
}

/**
 * Allowlist of URL prefixes the section-image injector accepts.
 * The HAST plugin runs AFTER `rehype-sanitize`, so any URL we
 * inject bypasses the sanitizer's protocol checks — we re-implement
 * the same posture here so a malformed DB row can't smuggle a
 * `javascript:` or `data:` URL into the published HTML.
 */
function isSafeHttpUrl(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  return value.startsWith("https://") || value.startsWith("http://");
}

/**
 * Builds the `<figure>` HAST node for a single section image. Uses
 * structured properties + text nodes so `rehype-stringify` handles
 * all HTML escaping (alt text with quotes, photographer names with
 * `<`, etc. all serialize safely). URLs are validated via
 * {@link isSafeHttpUrl} before being put on the node; an invalid
 * `imageUrl` skips the figure entirely (returns `null`), an invalid
 * link URL drops the link wrapper but keeps the photographer text.
 */
function buildSectionImageFigure(image: SectionImageForHtml): HastNode | null {
  if (!isSafeHttpUrl(image.imageUrl)) return null;

  const imgProperties: Record<string, unknown> = {
    src: image.imageUrl,
    alt: image.altText ?? "",
  };
  if (typeof image.wpMediaId === "number" && image.wpMediaId > 0) {
    imgProperties.className = [`wp-image-${image.wpMediaId}`];
  }

  const figureChildren: HastNode[] = [
    {
      type: "element",
      tagName: "img",
      properties: imgProperties,
      children: [],
    },
  ];

  const figcaption = buildAttributionFigcaption(image.attribution ?? null);
  if (figcaption) figureChildren.push(figcaption);

  return {
    type: "element",
    tagName: "figure",
    properties: { className: ["synthpress-section-image"] },
    children: figureChildren,
  };
}

/**
 * Builds the attribution `<figcaption>` for a section image.
 * Returns `null` when there's nothing meaningful to render
 * (manual-paste rows with no photographer + no link). Mirrors the
 * `MarkdownPreview` attribution-rendering branches so the
 * published HTML and the in-app preview produce visually-
 * consistent credit lines.
 */
function buildAttributionFigcaption(
  attribution: SectionImageAttributionForHtml | null,
): HastNode | null {
  if (!attribution) return null;
  // Provider label resolves: 'pexels' → 'Pexels' (active),
  // 'unsplash' → 'Unsplash' (legacy historical rows continue to
  // serialize correctly into published WordPress HTML), anything
  // else → raw id (forward-compat for future providers).
  /* v8 ignore start -- defensive: providerDisplayLabel only returns "" for empty/null/non-string input, but `attribution.provider` is typed `string` and required by SectionImageAttributionForHtml; fallback to raw id is unreachable from typed callers */
  const providerLabel =
    providerDisplayLabel(attribution.provider) || attribution.provider;
  /* v8 ignore stop */
  const photographerName = attribution.photographerName?.trim() || null;
  // Nothing to credit → no figcaption.
  if (!photographerName && !isSafeHttpUrl(attribution.photoUrl)) {
    return null;
  }

  const children: HastNode[] = [];
  if (photographerName) {
    children.push({ type: "text", value: "Photo by " });
    if (isSafeHttpUrl(attribution.photographerProfileUrl)) {
      children.push(
        buildExternalLink(attribution.photographerProfileUrl, photographerName),
      );
    } else {
      children.push({ type: "text", value: photographerName });
    }
    children.push({ type: "text", value: " on " });
  } else {
    children.push({ type: "text", value: "From " });
  }

  if (isSafeHttpUrl(attribution.photoUrl)) {
    children.push(buildExternalLink(attribution.photoUrl, providerLabel));
  } else {
    children.push({ type: "text", value: providerLabel });
  }

  return {
    type: "element",
    tagName: "figcaption",
    properties: {},
    children,
  };
}

function buildExternalLink(href: string, label: string): HastNode {
  return {
    type: "element",
    tagName: "a",
    properties: {
      href,
      // `nofollow` keeps Google from passing PageRank to user-
      // controlled outbound links; `noopener` + `noreferrer` are
      // the standard target=_blank safety pair.
      rel: ["nofollow", "noopener", "noreferrer"],
      target: "_blank",
    },
    children: [{ type: "text", value: label }],
  };
}

/**
 * Minimal HAST shapes the injector needs. Avoids pulling
 * `@types/hast` as a direct dep — same approach as
 * `extract-article-sections.ts` uses for mdast.
 */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}
interface HastRoot extends HastNode {
  type: "root";
  children: HastNode[];
}

/**
 * Rehype plugin: walks `root.children` once, finds top-level `<h2>`
 * nodes in document order, and splices a `<figure>` HAST node in
 * front of each one whose `section_key` (looked up by document
 * index against `orderedKeys`) has a matching image in the map.
 *
 * Runs AFTER `rehype-sanitize` in the pipeline below, so injected
 * nodes bypass sanitization — we hand-build them with structured
 * properties (auto-escaped by `rehype-stringify`) and validate
 * URLs via {@link isSafeHttpUrl}, which gives the same posture as
 * the sanitizer's protocol allowlist.
 *
 * Sub-tree H2s (inside a blockquote, etc.) are NOT matched on
 * purpose — `extractArticleSections` only counts top-level H2s, so
 * the index alignment between the parser and this plugin stays
 * correct only for top-level matches.
 */
function rehypeInjectSectionImages(options: {
  orderedKeys: string[];
  sectionImagesByKey: Record<string, SectionImageForHtml>;
}) {
  return (tree: HastRoot) => {
    if (options.orderedKeys.length === 0) return;
    const newChildren: HastNode[] = [];
    let h2Index = 0;
    for (const node of tree.children) {
      if (node.type === "element" && node.tagName === "h2") {
        const key = options.orderedKeys[h2Index];
        h2Index += 1;
        // `key` is always defined when `h2Index <
        // options.orderedKeys.length`. Since both `extractArticleSections`
        // and `remark-rehype` count the same top-level H2 nodes from
        // the same markdown, h2Index never overshoots — the
        // `key ?` ternary is a defensive guard that v8 can't
        // exercise from real input.
        /* v8 ignore next 1 -- defensive: orderedKeys is 1:1 with rendered H2 nodes by construction */
        const image = key ? options.sectionImagesByKey[key] : undefined;
        if (image) {
          const figure = buildSectionImageFigure(image);
          if (figure) newChildren.push(figure);
        }
      }
      newChildren.push(node);
    }
    tree.children = newChildren;
  };
}

/**
 * Converts Markdown to a sanitized HTML string. Returns an empty
 * string for null/empty/whitespace input — useful for the publish
 * helper which guards on "no body to publish" before calling out to
 * the remote API.
 *
 * `options.sectionImagesByKey` (optional) injects a `<figure>`
 * block above each H2 whose section key matches a map entry. Used
 * by the WordPress publish pipeline so what users see in the
 * SynthPress preview matches what lands on the published post.
 * When omitted, output is byte-for-byte identical to the v5
 * behavior.
 */
export async function markdownToHtml(
  markdown: string | null | undefined,
  options?: MarkdownToHtmlOptions,
): Promise<string> {
  if (!markdown || !markdown.trim()) return "";

  const sectionImagesByKey = options?.sectionImagesByKey;
  // No section data → reuse the pre-built BASE_PROCESSOR for the
  // hottest path (and the v5 byte-for-byte parity guarantee).
  if (!sectionImagesByKey || Object.keys(sectionImagesByKey).length === 0) {
    const file = await BASE_PROCESSOR.process(markdown);
    return String(file);
  }

  // Section data → build a one-shot processor that adds the
  // injector after sanitize. Compute `orderedKeys` once from the
  // same `extractArticleSections` the editor uses so keys align.
  const orderedKeys = extractArticleSections(markdown).map((s) => s.sectionKey);
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize, SANITIZE_SCHEMA)
    .use(() => rehypeInjectSectionImages({ orderedKeys, sectionImagesByKey }))
    .use(rehypeStringify);
  const file = await processor.process(markdown);
  return String(file);
}
