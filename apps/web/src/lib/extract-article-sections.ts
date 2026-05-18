import remarkParse from "remark-parse";
import { unified } from "unified";
import { slugify } from "./slugify";

/**
 * Minimal `mdast` shapes we need for H2 extraction.
 *
 * We don't `import type { Heading, Root } from "mdast"` because
 * `@types/mdast` isn't a direct dep — `remark-parse` brings in
 * `mdast-util-from-markdown` which carries the runtime types but
 * doesn't re-export the declaration namespace cleanly. Defining
 * the two structural shapes we touch here keeps the parser
 * dependency-free from the type side.
 */
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  depth?: number;
}
interface MdastHeading extends MdastNode {
  type: "heading";
  depth: number;
  children: MdastNode[];
}
interface MdastRoot extends MdastNode {
  type: "root";
  children: MdastNode[];
}

/**
 * Extracts level-2 headings from an article's Markdown body.
 *
 * Why H2 only:
 *   The article editor + AI conventions treat H1 as the title (which
 *   is a separate `articles.title` column, NOT in the body), and H2
 *   as the natural section divider. Future "section image above each
 *   H2" UI consumes this list to know where to slot images.
 *
 * AST instead of regex:
 *   We parse the Markdown via the same `remark-parse` pipeline the
 *   `markdown-to-html` lib uses. That avoids regex false-positives
 *   for `## something` lines inside fenced code blocks (which look
 *   like headings but aren't), and naturally handles inline
 *   formatting (`**bold**`, `[link](...)`) inside heading text.
 *
 * Section-key derivation:
 *   `slugify(headingText)` produces a stable, ASCII-only, hyphenated
 *   id ("How To Set Up" → "how-to-set-up"). When two headings
 *   slugify to the same key, we suffix the duplicate with `-2`,
 *   `-3`, etc. (FAQ-style articles often repeat headings — without
 *   the suffix, the section-image table would have ambiguous keys).
 *
 *   Headings whose text slugifies to the empty string (e.g. `## ☕`,
 *   `## ###`) get a synthetic `section-N` fallback so they still
 *   surface in the list with a stable key. Same dedupe rules apply.
 *
 * Order:
 *   `sortOrder` mirrors the document order — first H2 in the file
 *   gets `0`, second `1`, etc. The future section-image UI sorts by
 *   `sortOrder` so editor reorderings of the body show up in the
 *   image picker too.
 *
 * Pure function — server-safe (no `server-only` import) but in
 * practice always called from server code that has the article body
 * loaded.
 */

export interface ExtractedArticleSection {
  /** Stable, slug-friendly id derived from the heading text. */
  sectionKey: string;
  /** Plain-text heading content (inline Markdown stripped). */
  sectionHeading: string;
  /** 0-indexed document order. */
  sortOrder: number;
}

/**
 * Concatenates the plain-text content of a heading node. We walk the
 * subtree depth-first because heading children can include inline
 * markup (`**bold**` → `strong > text`, `[link](#)` → `link > text`,
 * etc.) and we want the user-visible text in document order, not BFS-
 * shuffled. Visit-self-then-children — a `paragraph` node has no
 * `value` of its own, so this is equivalent to "concat all leaf
 * `value` strings in left-to-right order".
 */
function readHeadingText(heading: MdastHeading): string {
  const parts: string[] = [];
  function walk(node: MdastNode): void {
    if (typeof node.value === "string") {
      parts.push(node.value);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }
  walk(heading);
  return parts.join("").trim();
}

/**
 * Suffix-deduper — when two headings produce the same `sectionKey`,
 * the second gets `-2`, the third `-3`, etc. Keeps section image
 * rows stable across re-saves of the same article body.
 */
function uniqueKey(
  base: string,
  used: Map<string, number>,
): string {
  const count = (used.get(base) ?? 0) + 1;
  used.set(base, count);
  if (count === 1) return base;
  return `${base}-${count}`;
}

const PROCESSOR = unified().use(remarkParse);

export function extractArticleSections(
  markdown: string | null | undefined,
): ExtractedArticleSection[] {
  if (typeof markdown !== "string" || !markdown.trim()) return [];

  const tree = PROCESSOR.parse(markdown) as MdastRoot;
  const sections: ExtractedArticleSection[] = [];
  const usedKeys = new Map<string, number>();
  let nextSyntheticIndex = 1;

  for (const node of tree.children) {
    if (node.type !== "heading") continue;
    const heading = node as MdastHeading;
    if (heading.depth !== 2) continue;

    const text = readHeadingText(heading);

    const baseKey = text ? slugify(text) : "";
    let sectionKey: string;
    if (baseKey) {
      sectionKey = uniqueKey(baseKey, usedKeys);
    } else {
      // Slugifies to nothing (empty heading or punctuation-only).
      // Synthesize a stable `section-N` key, then dedupe through
      // the same map so a real `## section-1` heading later in the
      // doc gets a `-2` suffix instead of colliding.
      sectionKey = uniqueKey(
        `section-${nextSyntheticIndex}`,
        usedKeys,
      );
      nextSyntheticIndex += 1;
    }

    sections.push({
      sectionKey,
      sectionHeading: text,
      sortOrder: sections.length,
    });
  }

  return sections;
}
