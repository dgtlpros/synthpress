import { describe, expect, it } from "vitest";
import { markdownToHtml } from "./markdown-to-html";

describe("markdownToHtml", () => {
  it("returns an empty string for null input", async () => {
    expect(await markdownToHtml(null)).toBe("");
  });

  it("returns an empty string for undefined input", async () => {
    expect(await markdownToHtml(undefined)).toBe("");
  });

  it("returns an empty string for whitespace-only input", async () => {
    expect(await markdownToHtml("   \n\t  ")).toBe("");
  });

  it("converts headings to HTML", async () => {
    const html = await markdownToHtml("# Hello\n\n## Subhead");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<h2>Subhead</h2>");
  });

  it("converts paragraphs and inline emphasis", async () => {
    const html = await markdownToHtml("Hello **world** and *friends*.");
    expect(html).toContain("<p>");
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<em>friends</em>");
  });

  it("converts unordered and ordered lists", async () => {
    const html = await markdownToHtml("- one\n- two\n\n1. first\n2. second");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
  });

  it("preserves http/https links and adds no rel attribute by default", async () => {
    const html = await markdownToHtml("[Cursor](https://cursor.com)");
    expect(html).toContain('href="https://cursor.com"');
    expect(html).toContain(">Cursor</a>");
  });

  it("renders GFM tables", async () => {
    const md = [
      "| Col A | Col B |",
      "| ----- | ----- |",
      "| a1    | b1    |",
    ].join("\n");
    const html = await markdownToHtml(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Col A</th>");
    expect(html).toContain("<td>a1</td>");
  });

  it("renders fenced code blocks", async () => {
    const html = await markdownToHtml("```\nconsole.log(1);\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("console.log(1);");
  });

  it("strips raw <script> tags from Markdown", async () => {
    const html = await markdownToHtml(
      "Hi\n\n<script>alert('xss')</script>\n\nbye",
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
  });

  it("strips inline event handler attributes", async () => {
    const html = await markdownToHtml(
      '<a href="https://example.com" onclick="alert(1)">click</a>',
    );
    expect(html).not.toContain("onclick");
  });

  it("strips javascript: URLs from Markdown links", async () => {
    const html = await markdownToHtml("[bad](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("strips data: URLs from img src", async () => {
    const html = await markdownToHtml(
      "![evil](data:text/html,<script>alert(1)</script>)",
    );
    expect(html).not.toContain("data:");
    expect(html).not.toContain("<script");
  });

  it("preserves blockquotes", async () => {
    const html = await markdownToHtml("> a quote");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("a quote");
  });

  it("does not include task list <input> checkboxes (form controls are stripped)", async () => {
    const html = await markdownToHtml("- [x] done\n- [ ] todo");
    expect(html).not.toContain("<input");
    // The list itself and its labels still render so the published
    // article has readable content even though the checkboxes are
    // gone.
    expect(html).toContain("<li");
    expect(html).toContain("done");
    expect(html).toContain("todo");
  });

  it("converts strikethrough via GFM", async () => {
    const html = await markdownToHtml("~~old~~");
    expect(html).toContain("<del>old</del>");
  });
});

describe("markdownToHtml — section image injection", () => {
  const SAMPLE_BODY = "## Intro\n\nIntro body.\n\n## FAQ\n\nFAQ body.\n";

  it("byte-for-byte identical output when no sectionImagesByKey is supplied", async () => {
    const without = await markdownToHtml(SAMPLE_BODY);
    const withEmpty = await markdownToHtml(SAMPLE_BODY, {});
    expect(without).toBe(withEmpty);
  });

  it("byte-for-byte identical output when sectionImagesByKey is empty", async () => {
    const without = await markdownToHtml(SAMPLE_BODY);
    const withEmpty = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {},
    });
    expect(without).toBe(withEmpty);
  });

  it("renders plain HTML when sectionImagesByKey is supplied but the body has no H2 sections", async () => {
    // Exercises the plugin's `options.orderedKeys.length === 0`
    // early-return — the publish UI prevents this (the section
    // editor only shows slots for present H2s) but the renderer
    // must be safe if it ever happens.
    const html = await markdownToHtml("# Title\n\nNo H2 here.", {
      sectionImagesByKey: {
        ghost: {
          imageUrl: "https://example.com/ghost.jpg",
          altText: null,
          attribution: null,
        },
      },
    });
    expect(html).not.toContain("ghost.jpg");
    expect(html).not.toContain("<figure");
    expect(html).toContain("<h1>Title</h1>");
  });

  it("injects a <figure> before the matching H2", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "https://example.com/intro.jpg",
          altText: "Intro hero",
          attribution: null,
        },
      },
    });
    expect(html).toContain(
      '<figure class="synthpress-section-image"><img src="https://example.com/intro.jpg" alt="Intro hero"></figure><h2>Intro</h2>',
    );
    // FAQ H2 still renders bare (no image for it).
    expect(html).toContain("<h2>FAQ</h2>");
    // No stray figures for unmatched sections.
    expect(html.match(/<figure/g)).toHaveLength(1);
  });

  it("injects a figure before EACH matching H2 in document order", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "https://example.com/intro.jpg",
          altText: null,
          attribution: null,
        },
        faq: {
          imageUrl: "https://example.com/faq.jpg",
          altText: null,
          attribution: null,
        },
      },
    });
    const introIdx = html.indexOf("https://example.com/intro.jpg");
    const faqIdx = html.indexOf("https://example.com/faq.jpg");
    const introH2Idx = html.indexOf("<h2>Intro</h2>");
    const faqH2Idx = html.indexOf("<h2>FAQ</h2>");
    expect(introIdx).toBeGreaterThan(-1);
    expect(faqIdx).toBeGreaterThan(-1);
    // Each figure precedes its matching H2.
    expect(introIdx).toBeLessThan(introH2Idx);
    expect(faqIdx).toBeLessThan(faqH2Idx);
    // intro figure precedes FAQ figure (document order preserved).
    expect(introIdx).toBeLessThan(faqIdx);
  });

  it("falls back to alt='' when altText is null (sanitizer-safe empty attribute)", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "https://example.com/intro.jpg",
          altText: null,
          attribution: null,
        },
      },
    });
    expect(html).toContain('alt=""');
  });

  it("adds the wp-image-<id> class on the <img> when wpMediaId is supplied", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "https://example.com/intro.jpg",
          altText: "Hero",
          wpMediaId: 421,
          attribution: null,
        },
      },
    });
    expect(html).toContain('class="wp-image-421"');
  });

  it("does NOT add a class attribute when wpMediaId is null/undefined/zero", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "https://example.com/intro.jpg",
          altText: "Hero",
          wpMediaId: 0,
          attribution: null,
        },
      },
    });
    expect(html).not.toMatch(/<img[^>]*class=/);
  });

  it("silently drops entries whose imageUrl is not http(s) (sanitizer parity)", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "javascript:alert(1)",
          altText: null,
          attribution: null,
        },
      },
    });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<figure");
    expect(html).toContain("<h2>Intro</h2>");
  });

  it("silently ignores entries whose key is not present in the body (orphan)", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        ghost: {
          imageUrl: "https://example.com/ghost.jpg",
          altText: null,
          attribution: null,
        },
      },
    });
    expect(html).not.toContain("ghost.jpg");
    expect(html).not.toContain("<figure");
  });

  it("matches duplicate H2 slugs via the parser's deduped keys (faq, faq-2, …)", async () => {
    const html = await markdownToHtml(
      "## FAQ\n\nfirst.\n\n## FAQ\n\nsecond.\n",
      {
        sectionImagesByKey: {
          faq: {
            imageUrl: "https://example.com/faq-1.jpg",
            altText: null,
            attribution: null,
          },
          "faq-2": {
            imageUrl: "https://example.com/faq-2.jpg",
            altText: null,
            attribution: null,
          },
        },
      },
    );
    const idx1 = html.indexOf("faq-1.jpg");
    const idx2 = html.indexOf("faq-2.jpg");
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(-1);
    expect(idx1).toBeLessThan(idx2);
  });

  it("renders Unsplash attribution: 'Photo by <a>Name</a> on <a>Unsplash</a>'", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "https://example.com/intro.jpg",
          altText: "Hero",
          attribution: {
            provider: "unsplash",
            photographerName: "Annie Spratt",
            photographerProfileUrl: "https://unsplash.com/@anniespratt",
            photoUrl: "https://unsplash.com/photos/abc",
          },
        },
      },
    });
    expect(html).toContain("<figcaption>");
    expect(html).toContain("Photo by ");
    expect(html).toContain(
      '<a href="https://unsplash.com/@anniespratt" rel="nofollow noopener noreferrer" target="_blank">Annie Spratt</a>',
    );
    expect(html).toContain(
      '<a href="https://unsplash.com/photos/abc" rel="nofollow noopener noreferrer" target="_blank">Unsplash</a>',
    );
  });

  it("renders photographer as plain text (no link) when profile URL is missing/unsafe", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "https://example.com/intro.jpg",
          altText: "Hero",
          attribution: {
            provider: "unsplash",
            photographerName: "Annie Spratt",
            photographerProfileUrl: null,
            photoUrl: "https://unsplash.com/photos/abc",
          },
        },
      },
    });
    expect(html).toContain("Photo by Annie Spratt on ");
    expect(html).not.toMatch(/<a[^>]*>Annie Spratt</);
  });

  it("renders provider as plain text when photoUrl is missing/unsafe", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "https://example.com/intro.jpg",
          altText: "Hero",
          attribution: {
            provider: "unsplash",
            photographerName: "Annie Spratt",
            photographerProfileUrl: "https://unsplash.com/@anniespratt",
            photoUrl: null,
          },
        },
      },
    });
    expect(html).not.toMatch(/<a[^>]*>Unsplash</);
    expect(html).toContain(" on Unsplash");
  });

  it("renders 'From <Provider>' when no photographer name is supplied", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "https://example.com/intro.jpg",
          altText: "Hero",
          attribution: {
            provider: "unsplash",
            photographerName: null,
            photographerProfileUrl: null,
            photoUrl: "https://unsplash.com/photos/abc",
          },
        },
      },
    });
    expect(html).toContain("From <a");
    expect(html).not.toContain("Photo by ");
  });

  it("omits the <figcaption> entirely when neither photographer nor photo URL is available", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "https://example.com/intro.jpg",
          altText: "Hero",
          attribution: {
            provider: "manual_url",
            photographerName: null,
            photographerProfileUrl: null,
            photoUrl: null,
          },
        },
      },
    });
    expect(html).toContain("<figure");
    expect(html).not.toContain("<figcaption");
  });

  it("uses raw provider id as the label for non-unsplash providers", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "https://example.com/intro.jpg",
          altText: "Hero",
          attribution: {
            provider: "pexels",
            photographerName: "Sam",
            photographerProfileUrl: "https://pexels.com/@sam",
            photoUrl: "https://pexels.com/photos/123",
          },
        },
      },
    });
    expect(html).toContain(">pexels<");
  });

  it("escapes HTML-unsafe characters in alt text (attribute context: quotes + ampersand)", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "https://example.com/intro.jpg",
          altText: 'A "quoted" & dangerous alt',
          attribution: null,
        },
      },
    });
    // Quote inside attribute value must be escaped so it doesn't
    // close the alt="..." attribute mid-value.
    expect(html).not.toContain('"A "quoted" & dangerous alt"');
    expect(html).toMatch(/alt="A &(quot|#x22|#34);quoted&(quot|#x22|#34); &(amp|#x26|#38); dangerous alt"/);
  });

  it("escapes HTML-unsafe characters in photographer name (text context: <, >, &)", async () => {
    // <script> inside heading TEXT context (not attribute) WOULD be
    // parsed as a tag, so escaping `<` / `>` / `&` is required here
    // to defeat injection through a malicious photographer-name
    // string. The HAST text-node serializer handles this for us.
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "https://example.com/intro.jpg",
          altText: "Hero",
          attribution: {
            provider: "unsplash",
            photographerName: "Annie & <script>alert(1)</script>",
            photographerProfileUrl: "https://unsplash.com/@anniespratt",
            photoUrl: "https://unsplash.com/photos/abc",
          },
        },
      },
    });
    // No raw script in the rendered text.
    expect(html).not.toContain("<script>alert(1)</script>Annie");
    expect(html).not.toContain(">Annie & <script>");
    // `<` and `&` are entity-encoded inside the text node so a
    // browser can't interpret them as tag boundaries. (`>` is
    // benign in text-content position and rehype-stringify leaves
    // it as-is, which is the standard HTML serializer behavior.)
    expect(html).toMatch(/Annie &(amp|#x26|#38);/);
    expect(html).toMatch(/&(lt|#x3C|#60);script/);
    expect(html).toMatch(/&(lt|#x3C|#60);\/script/);
  });

  it("rejects an injection link whose href is not http(s) (falls back to plain text)", async () => {
    const html = await markdownToHtml(SAMPLE_BODY, {
      sectionImagesByKey: {
        intro: {
          imageUrl: "https://example.com/intro.jpg",
          altText: "Hero",
          attribution: {
            provider: "unsplash",
            photographerName: "Annie",
            // Malicious URL — must not surface in the output.
            photographerProfileUrl: "javascript:alert(1)",
            photoUrl: "https://unsplash.com/photos/abc",
          },
        },
      },
    });
    expect(html).not.toContain("javascript:");
    // Photographer name still renders, just not as a link.
    expect(html).toContain("Photo by Annie on ");
  });
});
