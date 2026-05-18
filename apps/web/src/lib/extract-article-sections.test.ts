import { describe, expect, it } from "vitest";
import { extractArticleSections } from "./extract-article-sections";

describe("extractArticleSections — basics", () => {
  it("returns [] for null / undefined input", () => {
    expect(extractArticleSections(null)).toEqual([]);
    expect(extractArticleSections(undefined)).toEqual([]);
  });

  it("returns [] for an empty string", () => {
    expect(extractArticleSections("")).toEqual([]);
  });

  it("returns [] for a whitespace-only string", () => {
    expect(extractArticleSections("   \n  \n")).toEqual([]);
  });

  it("returns [] when the body has no H2 headings", () => {
    const md = `# Title

Just a paragraph.

A second paragraph.
`;
    expect(extractArticleSections(md)).toEqual([]);
  });
});

describe("extractArticleSections — extracts H2 only", () => {
  it("ignores H1 and H3+", () => {
    const md = `# H1 Title

## First section

### A subsection (H3)

#### Even deeper (H4)

## Second section

Body text.
`;
    expect(extractArticleSections(md)).toEqual([
      { sectionKey: "first-section", sectionHeading: "First section", sortOrder: 0 },
      { sectionKey: "second-section", sectionHeading: "Second section", sortOrder: 1 },
    ]);
  });

  it("preserves document order via sortOrder", () => {
    const md = `## Alpha

## Beta

## Gamma
`;
    const result = extractArticleSections(md);
    expect(result.map((s) => s.sectionKey)).toEqual(["alpha", "beta", "gamma"]);
    expect(result.map((s) => s.sortOrder)).toEqual([0, 1, 2]);
  });

  it("ignores `## ` patterns inside fenced code blocks (AST-correct)", () => {
    const md = `## Real heading

\`\`\`bash
## not a heading
echo "hi"
\`\`\`

## Another real heading
`;
    const result = extractArticleSections(md);
    expect(result.map((s) => s.sectionKey)).toEqual([
      "real-heading",
      "another-real-heading",
    ]);
  });
});

describe("extractArticleSections — heading text normalization", () => {
  it("strips inline emphasis from heading text + slug", () => {
    const md = `## **Bold** and *italic* heading`;
    expect(extractArticleSections(md)).toEqual([
      {
        sectionKey: "bold-and-italic-heading",
        sectionHeading: "Bold and italic heading",
        sortOrder: 0,
      },
    ]);
  });

  it("strips inline links from heading text + slug", () => {
    const md = `## How to use [Stripe](https://stripe.com) properly`;
    const result = extractArticleSections(md);
    expect(result[0]).toEqual({
      sectionKey: "how-to-use-stripe-properly",
      sectionHeading: "How to use Stripe properly",
      sortOrder: 0,
    });
  });

  it("strips inline code from heading text + slug", () => {
    const md = `## Using \`useState\` in React`;
    expect(extractArticleSections(md)[0]).toEqual({
      sectionKey: "using-usestate-in-react",
      sectionHeading: "Using useState in React",
      sortOrder: 0,
    });
  });

  it("trims surrounding whitespace from headings", () => {
    const md = `##    Trimmed heading   `;
    expect(extractArticleSections(md)[0]).toEqual({
      sectionKey: "trimmed-heading",
      sectionHeading: "Trimmed heading",
      sortOrder: 0,
    });
  });
});

describe("extractArticleSections — duplicate handling", () => {
  it("appends -2, -3, ... to duplicate slug keys", () => {
    const md = `## FAQ

## FAQ

## FAQ

## Pricing
`;
    const result = extractArticleSections(md);
    expect(result.map((s) => s.sectionKey)).toEqual([
      "faq",
      "faq-2",
      "faq-3",
      "pricing",
    ]);
    // Heading text is unchanged — only the key is dedup-suffixed.
    expect(result.every((s) => s.sectionHeading === "FAQ" || s.sectionHeading === "Pricing")).toBe(true);
  });

  it("treats slugified-to-same headings as duplicates", () => {
    const md = `## Hello, World!

## Hello World
`;
    // Both slugify to "hello-world".
    const result = extractArticleSections(md);
    expect(result.map((s) => s.sectionKey)).toEqual([
      "hello-world",
      "hello-world-2",
    ]);
    expect(result.map((s) => s.sectionHeading)).toEqual([
      "Hello, World!",
      "Hello World",
    ]);
  });
});

describe("extractArticleSections — edge cases", () => {
  it("falls back to a section-N key when the heading text slugifies to empty", () => {
    const md = `## ☕

## !!!

## Real one
`;
    const result = extractArticleSections(md);
    expect(result.map((s) => s.sectionKey)).toEqual([
      "section-1",
      "section-2",
      "real-one",
    ]);
    // The heading text is preserved verbatim (just trimmed).
    expect(result[0]!.sectionHeading).toBe("☕");
    expect(result[1]!.sectionHeading).toBe("!!!");
  });

  it("dedupes a synthetic section-N against a real `## section-1` later in the doc", () => {
    const md = `## ☕

## section-1
`;
    const result = extractArticleSections(md);
    expect(result.map((s) => s.sectionKey)).toEqual([
      "section-1",
      "section-1-2",
    ]);
  });

  it("preserves the heading text when it's empty (rare but valid Markdown)", () => {
    // `## ` (with trailing whitespace) parses as an empty H2.
    const md = `## \n\n## Real\n`;
    const result = extractArticleSections(md);
    expect(result.map((s) => s.sectionKey)).toEqual([
      "section-1",
      "real",
    ]);
    expect(result[0]!.sectionHeading).toBe("");
  });
});
