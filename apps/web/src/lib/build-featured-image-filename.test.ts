import { describe, expect, it } from "vitest";
import {
  buildFeaturedImageFilename,
  FEATURED_IMAGE_FILENAME_FALLBACK_BASE,
  FEATURED_IMAGE_FILENAME_MAX_BASE_LENGTH,
} from "./build-featured-image-filename";

describe("buildFeaturedImageFilename — base picking", () => {
  it("uses featuredImageAlt when present", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "Modern video doorbell on front porch",
        targetKeyword: "best smart locks for apartments",
        articleTitle: "How home security cameras work",
        contentType: "image/jpeg",
      }),
    ).toBe("modern-video-doorbell-on-front-porch.jpg");
  });

  it("falls back to targetKeyword when alt is null", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: null,
        targetKeyword: "best smart locks for apartments",
        articleTitle: "How home security cameras work",
        contentType: "image/webp",
      }),
    ).toBe("best-smart-locks-for-apartments.webp");
  });

  it("falls back to targetKeyword when alt is whitespace", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "   ",
        targetKeyword: "smart home cameras",
        articleTitle: "How home security cameras work",
        contentType: "image/png",
      }),
    ).toBe("smart-home-cameras.png");
  });

  it("falls back to articleTitle when both alt and keyword are missing", () => {
    expect(
      buildFeaturedImageFilename({
        articleTitle: "How Home Security Cameras Work",
        contentType: "image/png",
      }),
    ).toBe("how-home-security-cameras-work.png");
  });

  it("falls through to the synthpress fallback when every source is blank", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "",
        targetKeyword: null,
        articleTitle: undefined,
        contentType: "image/jpeg",
      }),
    ).toBe(`${FEATURED_IMAGE_FILENAME_FALLBACK_BASE}.jpg`);
  });

  it("falls through to the synthpress fallback when sources slugify to nothing", () => {
    // Punctuation-only / emoji-only inputs slugify to "", forcing the
    // helper to keep walking the priority list and ultimately pick
    // the generic fallback.
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "!!!",
        targetKeyword: "—",
        articleTitle: "",
        contentType: "image/png",
      }),
    ).toBe(`${FEATURED_IMAGE_FILENAME_FALLBACK_BASE}.png`);
  });

  it("ignores non-string sources (defensive)", () => {
    expect(
      buildFeaturedImageFilename({
        // Simulates a sloppy caller passing a number through the
        // optional fields. We treat anything that isn't a string as
        // missing without throwing.
        featuredImageAlt: 42 as unknown as string,
        targetKeyword: "valid keyword",
        contentType: "image/jpeg",
      }),
    ).toBe("valid-keyword.jpg");
  });
});

describe("buildFeaturedImageFilename — slugification", () => {
  it("lowercases the base", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "MIXED Case Title",
        contentType: "image/jpeg",
      }),
    ).toBe("mixed-case-title.jpg");
  });

  it("replaces spaces with hyphens", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "spaces  go    away",
        contentType: "image/jpeg",
      }),
    ).toBe("spaces-go-away.jpg");
  });

  it("strips quotes, semicolons, and other unsafe punctuation", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: 'Quote"; injected\\path/segment',
        contentType: "image/jpeg",
      }),
    ).toBe("quote-injected-path-segment.jpg");
  });

  it("strips control characters", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "tab\there\nnewline",
        contentType: "image/jpeg",
      }),
    ).toBe("tab-here-newline.jpg");
  });

  it("collapses duplicate hyphens", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "many---hyphens",
        contentType: "image/jpeg",
      }),
    ).toBe("many-hyphens.jpg");
  });

  it("trims leading and trailing hyphens", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "---wrapped---",
        contentType: "image/jpeg",
      }),
    ).toBe("wrapped.jpg");
  });

  it("strips emoji and non-ASCII letters", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "café ☕ vibes",
        contentType: "image/jpeg",
      }),
    ).toBe("caf-vibes.jpg");
  });

  it("preserves digits", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "Top 10 SaaS tools 2026",
        contentType: "image/jpeg",
      }),
    ).toBe("top-10-saas-tools-2026.jpg");
  });

  it("caps the slugified base at the maximum length", () => {
    const longInput = `${"alpha ".repeat(40).trim()}`;
    const result = buildFeaturedImageFilename({
      featuredImageAlt: longInput,
      contentType: "image/jpeg",
    });
    const base = result.slice(0, result.lastIndexOf("."));
    expect(base.length).toBeLessThanOrEqual(
      FEATURED_IMAGE_FILENAME_MAX_BASE_LENGTH,
    );
    expect(result.endsWith(".jpg")).toBe(true);
  });

  it("does not leave a trailing hyphen when truncating mid-word", () => {
    // Hand-craft an input that would land on a hyphen at the cap
    // boundary so we can prove the trailing-hyphen guard fires.
    const wordPattern = "word-".repeat(30); // → 150 chars, lots of "-"
    const result = buildFeaturedImageFilename({
      featuredImageAlt: wordPattern,
      contentType: "image/jpeg",
    });
    const base = result.slice(0, result.lastIndexOf("."));
    expect(base.endsWith("-")).toBe(false);
  });
});

describe("buildFeaturedImageFilename — extension picking", () => {
  it.each([
    ["image/jpeg", "jpg"],
    ["image/jpg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
  ])("maps %s → .%s", (contentType, expectedExt) => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "anything",
        contentType,
      }),
    ).toBe(`anything.${expectedExt}`);
  });

  it("normalizes content type case + strips parameters", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "thing",
        contentType: "Image/JPEG; charset=utf-8",
      }),
    ).toBe("thing.jpg");
  });

  it("falls back to .jpg when content type is missing", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "thing",
      }),
    ).toBe("thing.jpg");
  });

  it("falls back to .jpg when content type is unrecognized", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "thing",
        contentType: "image/heic",
      }),
    ).toBe("thing.jpg");
  });

  it("uses fallbackExtension when content type is unrecognized", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "thing",
        contentType: "image/heic",
        fallbackExtension: "png",
      }),
    ).toBe("thing.png");
  });

  it("strips a leading dot in fallbackExtension", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "thing",
        contentType: "application/octet-stream",
        fallbackExtension: ".png",
      }),
    ).toBe("thing.png");
  });

  it("ignores a blank fallbackExtension and uses .jpg", () => {
    expect(
      buildFeaturedImageFilename({
        featuredImageAlt: "thing",
        contentType: "application/octet-stream",
        fallbackExtension: "  ",
      }),
    ).toBe("thing.jpg");
  });
});
