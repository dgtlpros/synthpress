import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the image-provider registry so each test drives a fake
// provider directly. Same shape as `actions/unsplash.test.ts`.
vi.mock("@/services/image-providers/registry", () => ({
  getImageProvider: vi.fn(),
  DEFAULT_IMAGE_PROVIDER_ID: "unsplash",
}));

vi.mock("@/services/image-providers/types", () => {
  class ImageSearchError extends Error {
    code: string;
    providerId: string | null;
    details?: string;
    constructor(
      code: string,
      options: { providerId?: string | null; details?: string } = {},
    ) {
      super(`image_search_error:${code}`);
      this.code = code;
      this.providerId = options.providerId ?? null;
      this.details = options.details;
    }
  }
  return { ImageSearchError };
});

// Mock article-image-upload-service so we can assert on
// recordArticleImageUpload calls + return a fake "no existing
// section rows" list per test.
vi.mock("./article-image-upload-service", () => ({
  recordArticleImageUpload: vi.fn(),
  listSectionImageRowsForArticle: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { getImageProvider } from "@/services/image-providers/registry";
import { ImageSearchError } from "@/services/image-providers/types";
import {
  listSectionImageRowsForArticle,
  recordArticleImageUpload,
} from "./article-image-upload-service";
import { pickImagesForArticle } from "./article-image-picker-service";

const mockedGetProvider = vi.mocked(getImageProvider);
const mockedRecord = vi.mocked(recordArticleImageUpload);
const mockedListSections = vi.mocked(listSectionImageRowsForArticle);
const mockedCreateAdmin = vi.mocked(createAdminClient);

const mockedSearchImages = vi.fn();
const mockedTrackDownload = vi.fn();
const fakeProvider = {
  providerId: "unsplash",
  displayName: "Unsplash",
  searchImages: mockedSearchImages,
  trackDownload: mockedTrackDownload,
};

/**
 * Sample provider result — minimum fields the picker reads, plus
 * the optional ones to verify they flow into attribution metadata.
 */
function sampleResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    provider: "unsplash",
    providerPhotoId: "abc",
    description: null,
    altDescription: "A modern home office",
    thumbUrl: "https://x.com/t",
    regularUrl: "https://x.com/r",
    fullUrl: null,
    photographerName: "Annie Spratt",
    photographerProfileUrl: "https://unsplash.com/@anniespratt",
    photoUrl: "https://unsplash.com/photos/abc",
    downloadLocation: "https://api.unsplash.com/photos/abc/download",
    ...overrides,
  };
}

interface ArticleRowFixture {
  id: string;
  title: string;
  target_keyword: string | null;
  content_markdown: string | null;
  featured_image_url: string | null;
}

interface BlogRowFixture {
  niche: string | null;
  description: string | null;
}

const defaultArticle: ArticleRowFixture = {
  id: "a1",
  title: "How to launch a B2B blog",
  target_keyword: "launch b2b blog",
  content_markdown: "## Intro\n\nIntro body.\n\n## FAQ\n\nFAQ body.\n",
  featured_image_url: null,
};

const defaultBlog: BlogRowFixture = {
  niche: "B2B SaaS marketing",
  description: "Marketing playbooks for B2B SaaS founders.",
};

/**
 * Builds a Supabase client mock that returns a fresh chain per
 * `from()` call. Each table can be loaded with a queue of canned
 * `maybeSingle` results so tests can model "article exists, blog
 * exists" with two separate reads. The `update` chain resolves to
 * `{data, error}` and tracks the payload for assertions.
 */
function makeClient(opts: {
  articleReads?: Array<{ data: ArticleRowFixture | null; error: unknown | null }>;
  blogReads?: Array<{ data: BlogRowFixture | null; error: unknown | null }>;
  articleUpdateError?: unknown | null;
} = {}) {
  const articleReadQueue = [...(opts.articleReads ?? [{ data: defaultArticle, error: null }])];
  const blogReadQueue = [...(opts.blogReads ?? [{ data: defaultBlog, error: null }])];
  const articleUpdates: Array<Record<string, unknown>> = [];

  function makeArticleChain() {
    let isWrite = false;
    let eqCount = 0;
    const chain = {
      select: vi.fn(() => chain),
      update: vi.fn((payload: Record<string, unknown>) => {
        isWrite = true;
        articleUpdates.push(payload);
        return chain;
      }),
      eq: vi.fn(() => {
        eqCount += 1;
        // Write path terminates at `.update(...).eq("id", x)` —
        // one eq call.
        if (isWrite && eqCount === 1) {
          return Promise.resolve({
            data: null,
            error: opts.articleUpdateError ?? null,
          }) as never;
        }
        return chain;
      }),
      maybeSingle: vi.fn(() => {
        const next = articleReadQueue.shift() ?? { data: null, error: null };
        return Promise.resolve(next);
      }),
    };
    return chain;
  }

  function makeBlogChain() {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(() => {
        const next = blogReadQueue.shift() ?? { data: null, error: null };
        return Promise.resolve(next);
      }),
    };
    return chain;
  }

  const client = {
    from: vi.fn((table: string) => {
      if (table === "articles") return makeArticleChain();
      if (table === "blogs") return makeBlogChain();
      throw new Error(`unexpected table: ${table}`);
    }),
    __articleUpdates: articleUpdates,
  };
  return client as unknown as {
    from: ReturnType<typeof vi.fn>;
    __articleUpdates: Array<Record<string, unknown>>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetProvider.mockReturnValue(fakeProvider as never);
  mockedListSections.mockResolvedValue([]);
  mockedRecord.mockResolvedValue({} as never);
});

// ---------------------------------------------------------------------------
// Provider lookup
// ---------------------------------------------------------------------------

describe("pickImagesForArticle — provider lookup", () => {
  it("returns a warning + no images when the provider isn't registered (unsupported_provider)", async () => {
    mockedGetProvider.mockImplementation(() => {
      throw new ImageSearchError("unsupported_provider", {
        providerId: "made-up",
      });
    });

    const client = makeClient();
    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      providerId: "made-up",
      client: client as never,
    });

    expect(result.providerId).toBe("made-up");
    expect(result.featuredSelected).toBe(false);
    expect(result.sectionImagesSelected).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/not available/i);
    // No DB calls were made — short-circuited before article load.
    expect(client.from).not.toHaveBeenCalled();
  });

  it("uses DEFAULT_IMAGE_PROVIDER_ID ('unsplash') when providerId is omitted", async () => {
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const client = makeClient();
    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
    });
    expect(result.providerId).toBe("unsplash");
    expect(mockedGetProvider).toHaveBeenCalledWith("unsplash");
  });
});

// ---------------------------------------------------------------------------
// Featured image
// ---------------------------------------------------------------------------

describe("pickImagesForArticle — featured image", () => {
  it("picks the featured image and writes the article + attribution row", async () => {
    mockedSearchImages.mockResolvedValueOnce({
      results: [sampleResult()],
      totalResults: 1,
    });
    // Section call: empty body so no second search fires.
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "No headings here.",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
    });

    expect(result.featuredSelected).toBe(true);
    expect(result.warnings).toEqual([]);

    // Article update payload.
    expect(client.__articleUpdates[0]).toEqual({
      featured_image_url: "https://x.com/r",
      featured_image_alt: "A modern home office",
      wp_featured_media_id: null,
    });

    // Attribution row insert.
    expect(mockedRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        articleId: "a1",
        blogId: "b1",
        metadata: expect.objectContaining({
          provider: "unsplash",
          providerPhotoId: "abc",
          imageUrl: "https://x.com/r",
          altText: "A modern home office",
          wpMediaId: null,
        }),
        client: expect.anything(),
      }),
    );
    // The featured insert call has no `role` override → defaults to 'featured'.
    expect(mockedRecord.mock.calls[0]![0]!.role).toBeUndefined();
  });

  it("uses target_keyword as the featured search query before title or niche", async () => {
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const client = makeClient();
    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
    });
    expect(mockedSearchImages).toHaveBeenCalledWith(
      expect.objectContaining({ query: "launch b2b blog", perPage: 1 }),
    );
  });

  it("falls back to article.title when target_keyword is null", async () => {
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      target_keyword: null,
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });
    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeSections: false,
    });
    expect(mockedSearchImages).toHaveBeenCalledWith(
      expect.objectContaining({ query: defaultArticle.title }),
    );
  });

  it("warns when no query is derivable AND the blog row is null (e.g. tenant misconfig)", async () => {
    const article: ArticleRowFixture = {
      id: "a1",
      title: "",
      target_keyword: null,
      content_markdown: null,
      featured_image_url: null,
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
      // Blog row missing entirely — picker should gracefully
      // warn rather than throw.
      blogReads: [{ data: null, error: null }],
    });
    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeSections: false,
    });
    expect(result.featuredSelected).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/no target keyword/i);
  });

  it("falls back to blog.niche when target_keyword AND title are blank", async () => {
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      id: "a1",
      title: "",
      target_keyword: null,
      content_markdown: null,
      featured_image_url: null,
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });
    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeSections: false,
    });
    expect(mockedSearchImages).toHaveBeenCalledWith(
      expect.objectContaining({ query: "B2B SaaS marketing" }),
    );
  });

  it("warns + skips featured when no query can be derived", async () => {
    const article: ArticleRowFixture = {
      id: "a1",
      title: "",
      target_keyword: null,
      content_markdown: null,
      featured_image_url: null,
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
      blogReads: [{ data: { niche: null, description: null }, error: null }],
    });
    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeSections: false,
    });
    expect(result.featuredSelected).toBe(false);
    expect(mockedSearchImages).not.toHaveBeenCalled();
    expect(result.warnings.join(" ")).toMatch(/no target keyword/i);
  });

  it("skips the featured pick when the article already has a featured_image_url (force=false default)", async () => {
    const article: ArticleRowFixture = {
      ...defaultArticle,
      featured_image_url: "https://existing.com/featured.jpg",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });
    // Sections still run — provider returns empty so no inserts.
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
    });

    expect(result.featuredSelected).toBe(false);
    // No article UPDATE for the featured columns.
    expect(client.__articleUpdates).toEqual([]);
    // No insert for the featured role.
    const featuredInserts = mockedRecord.mock.calls.filter(
      (c) => c[0]?.role !== "section",
    );
    expect(featuredInserts).toHaveLength(0);
  });

  it("overwrites the existing featured image when force=true", async () => {
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "No headings here.",
      featured_image_url: "https://existing.com/featured.jpg",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });
    mockedSearchImages.mockResolvedValue({
      results: [sampleResult({ regularUrl: "https://x.com/new.jpg" })],
      totalResults: 1,
    });

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      force: true,
    });

    expect(result.featuredSelected).toBe(true);
    expect(client.__articleUpdates[0]?.featured_image_url).toBe(
      "https://x.com/new.jpg",
    );
  });

  it("records a warning and skips featured when the provider returns zero results", async () => {
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "No headings here.",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
    });

    expect(result.featuredSelected).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/no results for/i);
  });

  it("records a warning when the provider throws ImageSearchError (rate_limited)", async () => {
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "No headings here.",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });
    mockedSearchImages.mockRejectedValueOnce(
      new ImageSearchError("rate_limited"),
    );

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
    });

    expect(result.featuredSelected).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/rate_limited/);
  });

  it("falls back to a synthesized alt text when the photo has no altDescription or description", async () => {
    mockedSearchImages.mockResolvedValueOnce({
      results: [
        sampleResult({ altDescription: null, description: null }),
      ],
      totalResults: 1,
    });
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "No headings here.",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
    });

    expect(client.__articleUpdates[0]?.featured_image_alt).toBe(
      `Image for "${defaultArticle.title}"`,
    );
  });

  it("caps very long alt text at 300 characters", async () => {
    const longAlt = "x".repeat(500);
    mockedSearchImages.mockResolvedValueOnce({
      results: [sampleResult({ altDescription: longAlt })],
      totalResults: 1,
    });
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "No headings here.",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
    });

    expect(
      (client.__articleUpdates[0]?.featured_image_alt as string).length,
    ).toBe(300);
  });

  it("clears wp_featured_media_id on the article update (next WP sync re-uploads)", async () => {
    mockedSearchImages.mockResolvedValueOnce({
      results: [sampleResult()],
      totalResults: 1,
    });
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "No headings here.",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
    });

    expect(client.__articleUpdates[0]?.wp_featured_media_id).toBeNull();
  });

  it("skips featured when includeFeatured=false (sections still run)", async () => {
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const client = makeClient();

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });

    expect(result.featuredSelected).toBe(false);
    expect(client.__articleUpdates).toEqual([]);
    // Section listing still ran.
    expect(mockedListSections).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Section images
// ---------------------------------------------------------------------------

describe("pickImagesForArticle — section images", () => {
  it("extracts H2 sections from content_markdown and inserts a row per section", async () => {
    // Featured is OFF in this test → only the two section searches run.
    mockedSearchImages
      .mockResolvedValueOnce({
        results: [sampleResult({ regularUrl: "https://x.com/intro.jpg" })],
        totalResults: 1,
      })
      .mockResolvedValueOnce({
        results: [sampleResult({ regularUrl: "https://x.com/faq.jpg" })],
        totalResults: 1,
      });
    const client = makeClient();

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });

    expect(result.sectionsFound).toBe(2);
    expect(result.sectionImagesSelected).toBe(2);
    expect(result.warnings).toEqual([]);

    // Two section inserts.
    const sectionInserts = mockedRecord.mock.calls.filter(
      (c) => c[0]?.role === "section",
    );
    expect(sectionInserts).toHaveLength(2);
    expect(sectionInserts[0]![0]!.metadata).toMatchObject({
      role: "section",
      sectionKey: "intro",
      sectionHeading: "Intro",
      sortOrder: 0,
      imageUrl: "https://x.com/intro.jpg",
    });
    expect(sectionInserts[1]![0]!.metadata).toMatchObject({
      role: "section",
      sectionKey: "faq",
      sectionHeading: "FAQ",
      sortOrder: 1,
      imageUrl: "https://x.com/faq.jpg",
    });
  });

  it("returns sectionsFound=0 + sectionImagesSelected=0 when the body has no H2s", async () => {
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "# Title\n\nNo H2 here.",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
    });

    expect(result.sectionsFound).toBe(0);
    expect(result.sectionImagesSelected).toBe(0);
    // No section listing fired (early-return inside section pass).
    expect(mockedListSections).not.toHaveBeenCalled();
  });

  it("skips sections that already have a row (force=false default)", async () => {
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    // Intro already has a row; FAQ doesn't.
    mockedListSections.mockResolvedValueOnce([
      // Minimum fields the picker reads.
      { section_key: "intro" },
    ] as never);
    const client = makeClient();

    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });

    // Intro section was skipped — Intro's searches did NOT run.
    // FAQ ran through the fallback chain (3 queries: "FAQ
    // launch b2b blog", "FAQ", "launch b2b blog") because each
    // returned empty.
    const introCall = mockedSearchImages.mock.calls.find(
      (c) =>
        typeof c[0] === "object" &&
        c[0] !== null &&
        "query" in c[0] &&
        String((c[0] as { query: string }).query).startsWith("Intro"),
    );
    expect(introCall).toBeUndefined();
    const faqCalls = mockedSearchImages.mock.calls.filter(
      (c) =>
        typeof c[0] === "object" &&
        c[0] !== null &&
        "query" in c[0] &&
        String((c[0] as { query: string }).query).match(/FAQ|launch b2b blog/),
    );
    expect(faqCalls.length).toBeGreaterThan(0);
  });

  it("overwrites existing section rows when force=true", async () => {
    mockedSearchImages
      .mockResolvedValueOnce({
        results: [sampleResult({ regularUrl: "https://x.com/intro-new.jpg" })],
        totalResults: 1,
      })
      .mockResolvedValueOnce({
        results: [sampleResult({ regularUrl: "https://x.com/faq-new.jpg" })],
        totalResults: 1,
      });
    mockedListSections.mockResolvedValueOnce([
      { section_key: "intro" },
      { section_key: "faq" },
    ] as never);
    const client = makeClient();

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      force: true,
      includeFeatured: false,
    });

    expect(result.sectionImagesSelected).toBe(2);
    const sectionInserts = mockedRecord.mock.calls.filter(
      (c) => c[0]?.role === "section",
    );
    expect(sectionInserts).toHaveLength(2);
  });

  it("warns + continues when a single section search fails (rate_limited)", async () => {
    mockedSearchImages
      .mockRejectedValueOnce(new ImageSearchError("rate_limited"))
      .mockResolvedValueOnce({
        results: [sampleResult({ regularUrl: "https://x.com/faq.jpg" })],
        totalResults: 1,
      });
    const client = makeClient();

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });

    expect(result.sectionImagesSelected).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/rate_limited/);
    // FAQ insert still happened despite Intro failing.
    const sectionInserts = mockedRecord.mock.calls.filter(
      (c) => c[0]?.role === "section",
    );
    expect(sectionInserts).toHaveLength(1);
    expect(sectionInserts[0]![0]!.metadata).toMatchObject({
      sectionKey: "faq",
    });
  });

  it("warns + continues when a single section search returns zero results", async () => {
    mockedSearchImages
      .mockResolvedValueOnce({ results: [], totalResults: 0 })
      .mockResolvedValueOnce({
        results: [sampleResult()],
        totalResults: 1,
      });
    const client = makeClient();

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });

    expect(result.sectionImagesSelected).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/no results/);
  });

  it("section query combines heading + target_keyword when they differ", async () => {
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const client = makeClient();

    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });

    expect(mockedSearchImages).toHaveBeenCalledWith(
      expect.objectContaining({ query: "Intro launch b2b blog" }),
    );
    expect(mockedSearchImages).toHaveBeenCalledWith(
      expect.objectContaining({ query: "FAQ launch b2b blog" }),
    );
  });

  it("warns + skips a section when the heading is empty AND the article has no keyword OR title", async () => {
    // `## ` with whitespace-only heading → parser emits a
    // section with empty `sectionHeading`. With no target_keyword
    // AND no title to backfill the article-wide fallback, the
    // chain is empty and the picker must warn.
    const article: ArticleRowFixture = {
      id: "a1",
      title: "",
      target_keyword: null,
      content_markdown: "## \n\nBody.\n",
      featured_image_url: null,
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });

    expect(result.sectionsFound).toBe(1);
    expect(result.sectionImagesSelected).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/no query to search/);
    // No provider search fired for this section.
    expect(mockedSearchImages).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Fallback query chain (v8 polish)
  // -------------------------------------------------------------------------

  it("retries section search with heading-only when 'heading + keyword' returns zero results", async () => {
    mockedSearchImages
      // First call: "Intro launch b2b blog" → zero results.
      .mockResolvedValueOnce({ results: [], totalResults: 0 })
      // Second call: "Intro" → wins.
      .mockResolvedValueOnce({
        results: [sampleResult({ regularUrl: "https://x.com/intro.jpg" })],
        totalResults: 1,
      })
      // Provide a default for the FAQ section calls.
      .mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "## Intro\n\nBody.\n",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });

    expect(result.sectionImagesSelected).toBe(1);
    // Two calls in order: combined query → heading-only.
    expect(mockedSearchImages.mock.calls[0]![0]).toMatchObject({
      query: "Intro launch b2b blog",
    });
    expect(mockedSearchImages.mock.calls[1]![0]).toMatchObject({
      query: "Intro",
    });
    // Inserted attribution carries the WINNING photo (not a stale earlier one).
    expect(mockedRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          imageUrl: "https://x.com/intro.jpg",
        }),
      }),
    );
    expect(result.warnings).toEqual([]);
  });

  it("retries section search with article-wide query when heading attempts both return zero", async () => {
    mockedSearchImages
      // "Intro launch b2b blog" → 0
      .mockResolvedValueOnce({ results: [], totalResults: 0 })
      // "Intro" → 0
      .mockResolvedValueOnce({ results: [], totalResults: 0 })
      // "launch b2b blog" → wins
      .mockResolvedValueOnce({
        results: [sampleResult({ regularUrl: "https://x.com/wide.jpg" })],
        totalResults: 1,
      })
      .mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "## Intro\n\nBody.\n",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });

    expect(result.sectionImagesSelected).toBe(1);
    expect(mockedSearchImages.mock.calls[2]![0]).toMatchObject({
      query: "launch b2b blog",
    });
  });

  it("warns with attempt-count when ALL section fallback queries return zero", async () => {
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "## Intro\n\nBody.\n",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });

    expect(result.sectionImagesSelected).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/after 3 attempts/);
  });

  it("short-circuits the section retry chain on the first ImageSearchError (no retry burns the same rate-limit)", async () => {
    mockedSearchImages.mockRejectedValueOnce(
      new ImageSearchError("rate_limited"),
    );
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "## Intro\n\nBody.\n",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });

    expect(result.sectionImagesSelected).toBe(0);
    // Exactly ONE call — the chain stopped at the first provider error.
    expect(mockedSearchImages).toHaveBeenCalledOnce();
    expect(result.warnings.join(" ")).toMatch(/rate_limited/);
  });

  it("retries featured search with article title when target_keyword returns zero results", async () => {
    mockedSearchImages
      // "launch b2b blog" → 0
      .mockResolvedValueOnce({ results: [], totalResults: 0 })
      // "How to launch a B2B blog" → wins
      .mockResolvedValueOnce({
        results: [sampleResult({ regularUrl: "https://x.com/title.jpg" })],
        totalResults: 1,
      });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "No headings here.",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeSections: false,
    });

    expect(result.featuredSelected).toBe(true);
    expect(mockedSearchImages.mock.calls[0]![0]).toMatchObject({
      query: "launch b2b blog",
    });
    expect(mockedSearchImages.mock.calls[1]![0]).toMatchObject({
      query: "How to launch a B2B blog",
    });
  });

  it("retries featured search with blog niche when title also returns zero", async () => {
    mockedSearchImages
      .mockResolvedValueOnce({ results: [], totalResults: 0 })
      .mockResolvedValueOnce({ results: [], totalResults: 0 })
      .mockResolvedValueOnce({
        results: [sampleResult({ regularUrl: "https://x.com/niche.jpg" })],
        totalResults: 1,
      });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "No headings here.",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeSections: false,
    });

    expect(result.featuredSelected).toBe(true);
    expect(mockedSearchImages.mock.calls[2]![0]).toMatchObject({
      query: "B2B SaaS marketing",
    });
  });

  it("warns with attempt-count when ALL featured fallback queries return zero", async () => {
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "No headings here.",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeSections: false,
    });

    expect(result.featuredSelected).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/after 3 attempts/);
  });

  it("section chain falls back to article.title when target_keyword is null", async () => {
    // keyword=null + title set + heading set → chain is
    // ["Intro", title] (no combined query because keyword is
    // null). Verifies the `else if (title)` branch of the
    // article-wide fallback.
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      target_keyword: null,
      content_markdown: "## Intro\n\nBody.\n",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });
    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });
    expect(mockedSearchImages.mock.calls.map((c) => c[0]?.query)).toEqual([
      "Intro",
      "How to launch a B2B blog",
    ]);
  });

  it("section chain has only the heading when keyword AND title are both blank", async () => {
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      id: "a1",
      title: "",
      target_keyword: null,
      content_markdown: "## Intro\n\nBody.\n",
      featured_image_url: null,
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });
    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });
    // Only one search: the heading alone (article-wide fallback
    // collapses to "" and gets filtered out).
    expect(mockedSearchImages).toHaveBeenCalledOnce();
    expect(mockedSearchImages.mock.calls[0]![0]).toMatchObject({
      query: "Intro",
    });
  });

  it("de-duplicates section queries when heading + keyword + article-wide collapse to the same string", async () => {
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      id: "a1",
      title: "Intro",
      target_keyword: "Intro",
      content_markdown: "## Intro\n\nBody.\n",
      featured_image_url: null,
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });

    // Heading + keyword: skipped (they match case-insensitively).
    // Heading: "Intro".
    // Article-wide (keyword): "Intro" — de-duped against heading.
    // → exactly ONE search call.
    expect(mockedSearchImages).toHaveBeenCalledOnce();
    expect(mockedSearchImages.mock.calls[0]![0]).toMatchObject({
      query: "Intro",
    });
  });

  it("section query uses heading alone when target_keyword equals it (case-insensitive)", async () => {
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      target_keyword: "intro",
      content_markdown: "## Intro\n\nBody.",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });

    expect(mockedSearchImages).toHaveBeenCalledWith(
      expect.objectContaining({ query: "Intro" }),
    );
  });
});

// ---------------------------------------------------------------------------
// includeSections=false
// ---------------------------------------------------------------------------

describe("pickImagesForArticle — toggles", () => {
  it("skips section listing entirely when includeSections=false", async () => {
    mockedSearchImages.mockResolvedValueOnce({
      results: [sampleResult()],
      totalResults: 1,
    });
    const client = makeClient();

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeSections: false,
    });

    expect(result.sectionsFound).toBe(0);
    expect(result.sectionImagesSelected).toBe(0);
    expect(mockedListSections).not.toHaveBeenCalled();
  });

  it("normalizes null provider fields (photographer / urls / downloadLocation) to null on the attribution row", async () => {
    // Future-provider scenario: an image provider without
    // photographer or download-tracking metadata. The picker
    // must forward each missing field as explicit `null` on the
    // attribution row instead of leaking `undefined` to Supabase.
    mockedSearchImages.mockResolvedValueOnce({
      results: [
        sampleResult({
          photographerName: null,
          photographerProfileUrl: null,
          photoUrl: null,
          downloadLocation: null,
        }),
      ],
      totalResults: 1,
    });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "No headings here.",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
    });

    expect(mockedRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          photographerName: null,
          photographerProfileUrl: null,
          photoUrl: null,
          downloadLocation: null,
        }),
      }),
    );
  });

  it("returns a warning when the article is not found", async () => {
    const client = makeClient({
      articleReads: [{ data: null, error: null }],
    });

    const result = await pickImagesForArticle({
      articleId: "ghost",
      blogId: "b1",
      client: client as never,
    });

    expect(result.featuredSelected).toBe(false);
    expect(result.sectionImagesSelected).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/article not found/i);
    expect(mockedSearchImages).not.toHaveBeenCalled();
  });

  it("returns a warning when the article load throws", async () => {
    const client = makeClient({
      articleReads: [{ data: null, error: { message: "DB down" } }],
    });

    const result = await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
    });

    expect(result.featuredSelected).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/failed to load article/i);
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makeClient();
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });

    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
    });

    expect(mockedCreateAdmin).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Download-tracking posture (must NOT fire during selection)
// ---------------------------------------------------------------------------

describe("pickImagesForArticle — download tracking is NEVER called", () => {
  it("does not call provider.trackDownload during featured selection", async () => {
    mockedSearchImages.mockResolvedValueOnce({
      results: [sampleResult()],
      totalResults: 1,
    });
    mockedSearchImages.mockResolvedValue({ results: [], totalResults: 0 });
    const article: ArticleRowFixture = {
      ...defaultArticle,
      content_markdown: "No headings here.",
    };
    const client = makeClient({
      articleReads: [{ data: article, error: null }],
    });

    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
    });

    expect(mockedTrackDownload).not.toHaveBeenCalled();
  });

  it("does not call provider.trackDownload during section selection", async () => {
    mockedSearchImages.mockResolvedValue({
      results: [sampleResult()],
      totalResults: 1,
    });
    const client = makeClient();

    await pickImagesForArticle({
      articleId: "a1",
      blogId: "b1",
      client: client as never,
      includeFeatured: false,
    });

    expect(mockedTrackDownload).not.toHaveBeenCalled();
  });
});
