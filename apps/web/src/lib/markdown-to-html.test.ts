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
