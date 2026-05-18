import { describe, expect, it } from "vitest";
import { slugify } from "./slugify";

describe("slugify", () => {
  it("lowercases the result", () => {
    expect(slugify("Mixed Case Title")).toBe("mixed-case-title");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugify("spaces  go    away")).toBe("spaces-go-away");
  });

  it("strips quotes, semicolons, and other unsafe punctuation", () => {
    expect(slugify('Quote"; injected\\path/segment')).toBe(
      "quote-injected-path-segment",
    );
  });

  it("strips control characters", () => {
    expect(slugify("tab\there\nnewline")).toBe("tab-here-newline");
  });

  it("collapses duplicate hyphens", () => {
    expect(slugify("many---hyphens")).toBe("many-hyphens");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("---wrapped---")).toBe("wrapped");
  });

  it("strips emoji and non-ASCII letters", () => {
    expect(slugify("café ☕ vibes")).toBe("caf-vibes");
  });

  it("preserves digits", () => {
    expect(slugify("Top 10 SaaS tools 2026")).toBe("top-10-saas-tools-2026");
  });

  it("returns an empty string when the input is only punctuation", () => {
    expect(slugify("!!!")).toBe("");
  });

  it("returns an empty string when the input is only emoji", () => {
    expect(slugify("☕")).toBe("");
  });

  it("does NOT cap the length when no maxLength is supplied", () => {
    const long = "alpha-".repeat(50);
    const result = slugify(long);
    expect(result.length).toBeGreaterThan(100);
  });

  it("caps to maxLength when provided", () => {
    const long = "alpha-".repeat(50);
    const result = slugify(long, { maxLength: 32 });
    expect(result.length).toBeLessThanOrEqual(32);
  });

  it("does not leave a trailing hyphen after capping mid-hyphen", () => {
    // 30 chars per repeat of "word-" * 6 = 30 chars; capping at 30
    // would land mid-hyphen.
    const result = slugify("word-".repeat(20), { maxLength: 30 });
    expect(result.endsWith("-")).toBe(false);
  });
});
