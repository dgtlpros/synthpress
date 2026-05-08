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
