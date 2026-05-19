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
    const result = extractArticleSections(md);
    expect(result).toMatchObject([
      {
        sectionKey: "first-section",
        sectionHeading: "First section",
        sortOrder: 0,
      },
      {
        sectionKey: "second-section",
        sectionHeading: "Second section",
        sortOrder: 1,
      },
    ]);
    // Source offsets must be in ascending order (mirrors document
    // order) and pinpoint the `## ` for each H2.
    expect(result.map((s) => s.startOffset)).toEqual([
      md.indexOf("## First section"),
      md.indexOf("## Second section"),
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
    expect(extractArticleSections(md)).toMatchObject([
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
    expect(result[0]).toMatchObject({
      sectionKey: "how-to-use-stripe-properly",
      sectionHeading: "How to use Stripe properly",
      sortOrder: 0,
    });
  });

  it("strips inline code from heading text + slug", () => {
    const md = `## Using \`useState\` in React`;
    expect(extractArticleSections(md)[0]).toMatchObject({
      sectionKey: "using-usestate-in-react",
      sectionHeading: "Using useState in React",
      sortOrder: 0,
    });
  });

  it("trims surrounding whitespace from headings", () => {
    const md = `##    Trimmed heading   `;
    expect(extractArticleSections(md)[0]).toMatchObject({
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
    expect(
      result.every(
        (s) => s.sectionHeading === "FAQ" || s.sectionHeading === "Pricing",
      ),
    ).toBe(true);
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

describe("extractArticleSections — startOffset", () => {
  it("stamps startOffset matching the position of `## ` in the source", () => {
    // The leading `# Title\n\n` shifts the first H2 off offset 0 so
    // we can assert non-zero values for both headings.
    const md = `# Title\n\n## First\n\nbody.\n\n## Second\n`;
    const result = extractArticleSections(md);
    expect(result).toHaveLength(2);
    expect(result[0]!.startOffset).toBe(md.indexOf("## First"));
    expect(result[1]!.startOffset).toBe(md.indexOf("## Second"));
  });

  it("offsets are unique per H2 even when text + slug repeat", () => {
    // Duplicate headings (`## FAQ`, `## FAQ`) collapse to the same
    // text + slug-derived key, but the offsets still diverge so the
    // renderer can match each rendered <h2> to its own row.
    const md = `## FAQ\n\nfirst.\n\n## FAQ\n\nsecond.\n`;
    const result = extractArticleSections(md);
    const offsets = result.map((s) => s.startOffset);
    expect(new Set(offsets).size).toBe(2);
  });

  it("offsets ascend in document order even with H3s between H2s", () => {
    const md = `## A\n\n### sub\n\n## B\n\n### sub\n\n## C\n`;
    const result = extractArticleSections(md);
    const offsets = result.map((s) => s.startOffset ?? -1);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(offsets.every((o) => o >= 0)).toBe(true);
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
    expect(result.map((s) => s.sectionKey)).toEqual(["section-1", "real"]);
    expect(result[0]!.sectionHeading).toBe("");
  });
});
