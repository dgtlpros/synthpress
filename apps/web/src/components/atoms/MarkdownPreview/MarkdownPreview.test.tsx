import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MarkdownPreview } from "./MarkdownPreview";

afterEach(cleanup);

describe("MarkdownPreview", () => {
  it("renders headings as the matching tag", () => {
    render(<MarkdownPreview markdown={"# H1\n\n## H2\n\n### H3"} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("H1");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("H2");
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("H3");
  });

  it("renders paragraphs", () => {
    render(
      <MarkdownPreview
        markdown={"A first paragraph.\n\nA second paragraph."}
      />,
    );
    expect(screen.getByText("A first paragraph.")).toBeInTheDocument();
    expect(screen.getByText("A second paragraph.")).toBeInTheDocument();
  });

  it("renders unordered + ordered lists", () => {
    render(
      <MarkdownPreview markdown={"- one\n- two\n\n1. first\n2. second"} />,
    );
    expect(screen.getAllByRole("list")).toHaveLength(2);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("one");
    expect(items[3]).toHaveTextContent("second");
  });

  it("renders links as external + safe (target=_blank, rel=noopener)", () => {
    render(<MarkdownPreview markdown={"[link](https://example.com)"} />);
    const link = screen.getByRole("link", { name: "link" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders inline code differently from code blocks", () => {
    // Use a language-fenced code block so react-markdown passes a
    // `language-ts` className through to our `code` override (which
    // branches on whether className is present to pick the block vs.
    // inline rendering path).
    const { container } = render(
      <MarkdownPreview
        markdown={"Inline `code` here.\n\n```ts\nconst x = 1;\n```"}
      />,
    );
    const codeNodes = container.querySelectorAll("code");
    expect(codeNodes.length).toBe(2);
    // The block code's inner <code> carries the language- class (proves
    // our `isBlock` branch fired); the inline <code> does not.
    const hasLanguageClass = Array.from(codeNodes).some((node) =>
      node.className.includes("language-ts"),
    );
    expect(hasLanguageClass).toBe(true);
    expect(container.querySelector("pre")).not.toBeNull();
  });

  it("renders blockquotes", () => {
    const { container } = render(
      <MarkdownPreview markdown={"> a famous quote"} />,
    );
    expect(container.querySelector("blockquote")).not.toBeNull();
    expect(screen.getByText(/a famous quote/i)).toBeInTheDocument();
  });

  it("renders GitHub-flavoured Markdown tables via remark-gfm", () => {
    render(
      <MarkdownPreview
        markdown={
          "| col1 | col2 |\n|------|------|\n| a    | b    |\n| c    | d    |"
        }
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("col1")).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  it("renders horizontal rules", () => {
    const { container } = render(
      <MarkdownPreview markdown={"section\n\n---\n\nnext section"} />,
    );
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders images with the alt text from Markdown", () => {
    const { container } = render(
      <MarkdownPreview markdown={"![alt text](https://example.com/img.png)"} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://example.com/img.png");
    expect(img!.getAttribute("alt")).toBe("alt text");
  });

  it("falls back to an empty alt when Markdown omits one", () => {
    const { container } = render(
      <MarkdownPreview markdown={"![](https://example.com/img.png)"} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("alt")).toBe("");
  });

  it("forwards a custom className to the root", () => {
    const { container } = render(
      <MarkdownPreview markdown={"text"} className="custom-cls" />,
    );
    expect(container.firstChild).toHaveClass("custom-cls");
  });
});

describe("MarkdownPreview — section images", () => {
  const TWO_SECTION_BODY = "## Intro\n\nIntro body.\n\n## FAQ\n\nFaq body.\n";

  it("does NOT inject any images when sectionImagesByKey is omitted", () => {
    const { container } = render(
      <MarkdownPreview markdown={TWO_SECTION_BODY} />,
    );
    expect(container.querySelector("figure")).toBeNull();
    // The H2s themselves still render normally.
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2);
  });

  it("does NOT inject anything when sectionImagesByKey is empty", () => {
    const { container } = render(
      <MarkdownPreview markdown={TWO_SECTION_BODY} sectionImagesByKey={{}} />,
    );
    expect(container.querySelector("figure")).toBeNull();
  });

  it("renders a section image above the matching H2", () => {
    const { container } = render(
      <MarkdownPreview
        markdown={TWO_SECTION_BODY}
        sectionImagesByKey={{
          intro: {
            imageUrl: "https://example.com/intro.jpg",
            altText: "Intro hero",
            attribution: null,
          },
        }}
      />,
    );
    const figures = container.querySelectorAll("figure");
    expect(figures).toHaveLength(1);
    const img = figures[0]!.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://example.com/intro.jpg");
    expect(img?.getAttribute("alt")).toBe("Intro hero");
  });

  it("renders ONE figure per H2 when both keys are mapped", () => {
    const { container } = render(
      <MarkdownPreview
        markdown={TWO_SECTION_BODY}
        sectionImagesByKey={{
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
        }}
      />,
    );
    const figures = container.querySelectorAll("figure");
    expect(figures).toHaveLength(2);
    expect(figures[0]!.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/intro.jpg",
    );
    expect(figures[1]!.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/faq.jpg",
    );
  });

  it("falls back to empty alt when altText is null", () => {
    const { container } = render(
      <MarkdownPreview
        markdown={"## Intro\n\nbody.\n"}
        sectionImagesByKey={{
          intro: {
            imageUrl: "https://example.com/intro.jpg",
            altText: null,
            attribution: null,
          },
        }}
      />,
    );
    expect(container.querySelector("figure img")?.getAttribute("alt")).toBe("");
  });

  it("renders Unsplash attribution credit when supplied", () => {
    render(
      <MarkdownPreview
        markdown={"## Intro\n\nbody.\n"}
        sectionImagesByKey={{
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
        }}
      />,
    );
    const credit = screen.getByText(/photo by/i);
    expect(credit).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Annie Spratt" })).toHaveAttribute(
      "href",
      "https://unsplash.com/@anniespratt",
    );
    expect(screen.getByRole("link", { name: "Unsplash" })).toHaveAttribute(
      "href",
      "https://unsplash.com/photos/abc",
    );
  });

  it("renders photographer as plain text (no link) when profile URL is null", () => {
    render(
      <MarkdownPreview
        markdown={"## Intro\n\nbody.\n"}
        sectionImagesByKey={{
          intro: {
            imageUrl: "https://example.com/intro.jpg",
            altText: null,
            attribution: {
              provider: "unsplash",
              photographerName: "Annie Spratt",
              photographerProfileUrl: null,
              photoUrl: "https://unsplash.com/photos/abc",
            },
          },
        }}
      />,
    );
    // Photographer name is rendered but NOT as a link.
    expect(
      screen.queryByRole("link", { name: "Annie Spratt" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Annie Spratt")).toBeInTheDocument();
  });

  it("renders provider as plain text (no link) when photoUrl is null", () => {
    render(
      <MarkdownPreview
        markdown={"## Intro\n\nbody.\n"}
        sectionImagesByKey={{
          intro: {
            imageUrl: "https://example.com/intro.jpg",
            altText: null,
            attribution: {
              provider: "unsplash",
              photographerName: "Annie Spratt",
              photographerProfileUrl: "https://unsplash.com/@anniespratt",
              photoUrl: null,
            },
          },
        }}
      />,
    );
    expect(
      screen.queryByRole("link", { name: /^Unsplash$/ }),
    ).not.toBeInTheDocument();
  });

  it("renders 'From <Provider>' (no 'Photo by') when no photographer", () => {
    render(
      <MarkdownPreview
        markdown={"## Intro\n\nbody.\n"}
        sectionImagesByKey={{
          intro: {
            imageUrl: "https://example.com/intro.jpg",
            altText: null,
            attribution: {
              provider: "unsplash",
              photographerName: null,
              photographerProfileUrl: null,
              photoUrl: "https://unsplash.com/photos/abc",
            },
          },
        }}
      />,
    );
    expect(screen.getByText(/^From/)).toBeInTheDocument();
  });

  it("skips the figcaption entirely when attribution has neither name nor link", () => {
    const { container } = render(
      <MarkdownPreview
        markdown={"## Intro\n\nbody.\n"}
        sectionImagesByKey={{
          intro: {
            imageUrl: "https://example.com/intro.jpg",
            altText: null,
            attribution: {
              provider: "manual_url",
              photographerName: null,
              photographerProfileUrl: null,
              photoUrl: null,
            },
          },
        }}
      />,
    );
    expect(container.querySelector("figcaption")).toBeNull();
  });

  it("renders 'Pexels' (not 'pexels') as the provider label for the active provider", () => {
    render(
      <MarkdownPreview
        markdown={"## Intro\n\nbody.\n"}
        sectionImagesByKey={{
          intro: {
            imageUrl: "https://example.com/intro.jpg",
            altText: null,
            attribution: {
              provider: "pexels",
              photographerName: "Sam",
              photographerProfileUrl: "https://pexels.com/@sam",
              photoUrl: "https://pexels.com/photos/123",
            },
          },
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Pexels" })).toBeInTheDocument();
  });

  it("falls through to the raw provider id for unknown / future providers", () => {
    // 'midjourney' isn't in the display-label map so the renderer
    // surfaces the raw id verbatim. Keeps unmapped data legible
    // without silently hiding what's actually persisted.
    render(
      <MarkdownPreview
        markdown={"## Intro\n\nbody.\n"}
        sectionImagesByKey={{
          intro: {
            imageUrl: "https://example.com/intro.jpg",
            altText: null,
            attribution: {
              provider: "midjourney",
              photographerName: "Bot",
              photographerProfileUrl: "https://example.com/@bot",
              photoUrl: "https://example.com/photos/123",
            },
          },
        }}
      />,
    );
    expect(
      screen.getByRole("link", { name: "midjourney" }),
    ).toBeInTheDocument();
  });

  it("silently ignores entries whose key isn't present in the body (orphaned)", () => {
    const { container } = render(
      <MarkdownPreview
        markdown={"## Intro\n\nbody.\n"}
        sectionImagesByKey={{
          intro: {
            imageUrl: "https://example.com/intro.jpg",
            altText: null,
            attribution: null,
          },
          ghost: {
            // Section was removed from the body but the row still
            // exists in the picker map — must not render.
            imageUrl: "https://example.com/ghost.jpg",
            altText: null,
            attribution: null,
          },
        }}
      />,
    );
    const figures = container.querySelectorAll("figure");
    expect(figures).toHaveLength(1);
    expect(figures[0]!.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/intro.jpg",
    );
  });

  it("matches duplicate H2 slugs via the parser's deduped keys (faq, faq-2, …)", () => {
    const { container } = render(
      <MarkdownPreview
        markdown={"## FAQ\n\nfirst body.\n\n## FAQ\n\nsecond body.\n"}
        sectionImagesByKey={{
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
        }}
      />,
    );
    const srcs = Array.from(container.querySelectorAll("figure img")).map((n) =>
      n.getAttribute("src"),
    );
    expect(srcs).toEqual([
      "https://example.com/faq-1.jpg",
      "https://example.com/faq-2.jpg",
    ]);
  });

  it("renders ALL section images under StrictMode (regression for index-counter double-invoke bug)", () => {
    // React's StrictMode double-invokes function components in
    // development. A previous implementation tracked which H2 was
    // being rendered with a `let h2Counter = { value: 0 }` mutated
    // inside the H2 component override. The second strict-mode
    // invocation kept incrementing the same counter, so for an
    // article with N H2s + N images the renderer would commit
    // image[1], image[3], ... image[2N-1] for the H2s and undefined
    // for the trailing half — visually presenting as "first few
    // images render (wrong photo) + last few are missing" plus a
    // hydration mismatch against the SSR pass (which is single-
    // invocation). The position-based join is purely functional,
    // so StrictMode double-invoke produces identical output.
    //
    // Five H2s is enough to exercise the failure mode: the buggy
    // code would have shown only sections 1 + 2's figures (with
    // images 2 + 4) and dropped 3, 4, 5 entirely.
    const FIVE_SECTION_BODY = [
      "## One",
      "",
      "body 1.",
      "",
      "## Two",
      "",
      "body 2.",
      "",
      "## Three",
      "",
      "body 3.",
      "",
      "## Four",
      "",
      "body 4.",
      "",
      "## Five",
      "",
      "body 5.",
      "",
    ].join("\n");
    const { container } = render(
      <StrictMode>
        <MarkdownPreview
          markdown={FIVE_SECTION_BODY}
          sectionImagesByKey={{
            one: {
              imageUrl: "https://example.com/1.jpg",
              altText: null,
              attribution: null,
            },
            two: {
              imageUrl: "https://example.com/2.jpg",
              altText: null,
              attribution: null,
            },
            three: {
              imageUrl: "https://example.com/3.jpg",
              altText: null,
              attribution: null,
            },
            four: {
              imageUrl: "https://example.com/4.jpg",
              altText: null,
              attribution: null,
            },
            five: {
              imageUrl: "https://example.com/5.jpg",
              altText: null,
              attribution: null,
            },
          }}
        />
      </StrictMode>,
    );
    const srcs = Array.from(container.querySelectorAll("figure img")).map((n) =>
      n.getAttribute("src"),
    );
    expect(srcs).toEqual([
      "https://example.com/1.jpg",
      "https://example.com/2.jpg",
      "https://example.com/3.jpg",
      "https://example.com/4.jpg",
      "https://example.com/5.jpg",
    ]);
  });
});
