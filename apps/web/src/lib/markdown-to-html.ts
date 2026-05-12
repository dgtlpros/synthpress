import "server-only";

import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

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

const PROCESSOR = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize, SANITIZE_SCHEMA)
  .use(rehypeStringify);

/**
 * Converts Markdown to a sanitized HTML string. Returns an empty
 * string for null/empty/whitespace input — useful for the publish
 * helper which guards on "no body to publish" before calling out to
 * the remote API.
 */
export async function markdownToHtml(
  markdown: string | null | undefined,
): Promise<string> {
  if (!markdown || !markdown.trim()) return "";
  const file = await PROCESSOR.process(markdown);
  return String(file);
}
