import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/markdown-to-html", () => ({
  markdownToHtml: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { markdownToHtml } from "@/lib/markdown-to-html";
import {
  buildBasicAuthHeader,
  buildWordPressMediaEndpoint,
  buildWordPressPostsEndpoint,
  clearWordPressLink,
  PublishArticleError,
  publishArticleToWordPressDraft,
  publishArticleToWordPressLive,
  updateArticleWordPressDraft,
  uploadMediaToWordPress,
} from "./wordpress-publish-service";

const mockedCreateAdmin = vi.mocked(createAdminClient);
const mockedMarkdownToHtml = vi.mocked(markdownToHtml);

interface ArticleRow {
  id: string;
  blog_id: string;
  title: string;
  slug: string | null;
  excerpt: string;
  content_markdown: string | null;
  meta_description: string | null;
  target_keyword: string | null;
  wp_post_id: number | null;
  featured_image_url: string | null;
  featured_image_alt: string | null;
  wp_featured_media_id: number | null;
}

interface BlogConnRow {
  wp_url: string | null;
  wp_username: string | null;
  wp_app_password: string | null;
}

interface PublishedAtRow {
  published_at: string | null;
}

interface ImageUploadRowFixture {
  id: string;
  article_id: string;
  blog_id: string;
  provider: string;
  provider_photo_id: string | null;
  image_url: string;
  alt_text: string | null;
  photographer_name: string | null;
  photographer_profile_url: string | null;
  photo_url: string | null;
  download_location: string | null;
  wp_media_id: number | null;
  role: string;
  section_key?: string | null;
  section_heading?: string | null;
  sort_order?: number;
  created_at: string;
  updated_at: string;
}

interface MockClientOptions {
  /** Queue of rows returned by successive `articles` SELECTs. */
  articleReads?: Array<ArticleRow | PublishedAtRow | null>;
  /** Queue of errors paired 1:1 with `articleReads`. Use `null` for a healthy read. */
  articleReadErrors?: Array<{ message: string } | null>;
  blog?: BlogConnRow | null;
  blogError?: { message: string } | null;
  /** Queue of errors paired 1:1 with `articles` UPDATEs. */
  articleUpdateErrors?: Array<{ message: string } | null>;
  /**
   * Active attribution row for the article (returned by
   * `getActiveImageUploadForArticle`). `undefined` => no row matches
   * (manual paste / pre-attribution upload). `null` => row is
   * deliberately empty (test-side null).
   */
  activeImageUpload?: ImageUploadRowFixture | null;
  /**
   * Section image rows returned by
   * `listSectionImageRowsForArticle`. Empty array by default — the
   * v5 publish flow only loads them but doesn't act on them; v6
   * picks each row up and either reuses its `wp_media_id` or
   * uploads to WordPress media.
   */
  sectionImageRows?: ImageUploadRowFixture[];
}

interface MockClient {
  client: never;
  recordedUpdates: Array<Record<string, unknown>>;
  /** All update payloads written to `article_image_uploads` (for assertions). */
  recordedImageUploadUpdates: Array<Record<string, unknown>>;
  blogChain: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };
}

/**
 * Dual-chain mock: each `from("articles")` call returns a chain that
 * supports BOTH `.select().eq().maybeSingle()` and `.update().eq().eq()`.
 * The first method called on the chain decides which path the chain
 * takes when the consumer awaits.
 *
 * Why dual-chain instead of "1st call is read, rest are writes":
 *   `publish_live` does TWO reads on articles (loadArticleForPublish,
 *   then a `published_at` check) plus one UPDATE — so the simple
 *   "first-call-is-read" heuristic doesn't work.
 */
function makeClient(options: MockClientOptions = {}): MockClient {
  const articleReadQueue: Array<ArticleRow | PublishedAtRow | null> = [
    ...(options.articleReads ?? [defaultArticle]),
  ];
  const articleReadErrorQueue: Array<{ message: string } | null> = [
    ...(options.articleReadErrors ?? []),
  ];
  const articleUpdateErrorQueue: Array<{ message: string } | null> = [
    ...(options.articleUpdateErrors ?? []),
  ];
  const recordedUpdates: Array<Record<string, unknown>> = [];

  function makeArticleChain() {
    let isWrite = false;
    let eqCount = 0;
    const chain = {
      select: vi.fn(() => chain),
      update: vi.fn((payload: Record<string, unknown>) => {
        isWrite = true;
        recordedUpdates.push(payload);
        return chain;
      }),
      eq: vi.fn(() => {
        eqCount += 1;
        if (isWrite && eqCount === 2) {
          const err = articleUpdateErrorQueue.length
            ? articleUpdateErrorQueue.shift()!
            : null;
          return Promise.resolve({ data: null, error: err }) as never;
        }
        return chain;
      }),
      maybeSingle: vi.fn(() => {
        const data = articleReadQueue.length ? articleReadQueue.shift()! : null;
        const err = articleReadErrorQueue.length
          ? articleReadErrorQueue.shift()!
          : null;
        return Promise.resolve({ data, error: err });
      }),
    };
    return chain;
  }

  const blogChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: options.blog === undefined ? defaultBlog : options.blog,
      error: options.blogError ?? null,
    }),
  };

  // Tracks every `.update(payload)` written against
  // `article_image_uploads`. Tests assert the wp_media_id stamp on it.
  const recordedImageUploadUpdates: Array<Record<string, unknown>> = [];

  /**
   * Tracks how many calls into `listSectionImageRowsForArticle`
   * have happened, so a test can supply a different result for
   * each (today only one call per publish; kept as a queue for
   * forward-compat with retry tests).
   */
  const sectionListResults = [...(options.sectionImageRows ?? [])];
  let sectionListUsed = false;

  function makeImageUploadChain() {
    let isWrite = false;
    let isDelete = false;
    let eqCount = 0;
    const chain = {
      select: vi.fn(() => chain),
      update: vi.fn((payload: Record<string, unknown>) => {
        isWrite = true;
        recordedImageUploadUpdates.push(payload);
        return chain;
      }),
      delete: vi.fn(() => {
        isDelete = true;
        return chain;
      }),
      eq: vi.fn(() => {
        eqCount += 1;
        // Update path: `stampWordPressMediaIdOnImageUpload` does
        // `.update().eq("id", x)` — terminate on the first eq.
        if (isWrite && eqCount === 1) {
          return Promise.resolve({ data: null, error: null }) as never;
        }
        // Delete path (not yet used by publish but kept for
        // forward-compat with the section-image sync helper that
        // shares this mock pattern).
        if (isDelete && eqCount === 1) {
          return Promise.resolve({ data: null, error: null }) as never;
        }
        return chain;
      }),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(() =>
        Promise.resolve({
          data: options.activeImageUpload ?? null,
          error: null,
        }),
      ),
      // Thenable: the section-image list query
      // (`select().eq().eq().order().order()`) awaits the chain
      // directly. The first await consumes the sectionImageRows
      // fixture; subsequent awaits get [] so a retry test can
      // distinguish first vs. second list calls.
      then: (
        onFulfilled?: (value: {
          data: ImageUploadRowFixture[];
          error: null;
        }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => {
        const data = sectionListUsed ? [] : sectionListResults;
        sectionListUsed = true;
        return Promise.resolve({ data, error: null }).then(
          onFulfilled,
          onRejected,
        );
      },
    };
    return chain;
  }

  const client = {
    from: vi.fn((table: string) => {
      if (table === "articles") return makeArticleChain();
      if (table === "blogs") return blogChain;
      if (table === "article_image_uploads") return makeImageUploadChain();
      throw new Error(`unexpected table: ${table}`);
    }),
  };

  return {
    client: client as never,
    recordedUpdates,
    recordedImageUploadUpdates,
    blogChain,
  };
}

const defaultArticle: ArticleRow = {
  id: "a1",
  blog_id: "b1",
  title: "Hello WP",
  slug: "hello-wp",
  excerpt: "An excerpt.",
  content_markdown: "# Body\n\nHello world.",
  meta_description: "A meta description.",
  target_keyword: null,
  wp_post_id: null,
  featured_image_url: null,
  featured_image_alt: null,
  wp_featured_media_id: null,
};

const defaultBlog: BlogConnRow = {
  wp_url: "https://example.com",
  wp_username: "wpuser",
  wp_app_password: "abcd efgh ijkl mnop",
};

function makeOkResponse(
  body: { id: number; link?: string | null } = {
    id: 7,
    link: "https://example.com/?p=7",
  },
) {
  return {
    ok: true,
    status: 201,
    statusText: "Created",
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(""),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedMarkdownToHtml.mockResolvedValue("<h1>Body</h1><p>Hello world.</p>");
});

describe("buildWordPressPostsEndpoint", () => {
  it("appends the REST path to a bare site URL", () => {
    expect(buildWordPressPostsEndpoint("https://example.com")).toBe(
      "https://example.com/wp-json/wp/v2/posts",
    );
  });

  it("strips trailing slashes before appending", () => {
    expect(buildWordPressPostsEndpoint("https://example.com///")).toBe(
      "https://example.com/wp-json/wp/v2/posts",
    );
  });

  it("trims whitespace before appending", () => {
    expect(buildWordPressPostsEndpoint("  https://example.com  ")).toBe(
      "https://example.com/wp-json/wp/v2/posts",
    );
  });

  it("appends the post id when provided", () => {
    expect(buildWordPressPostsEndpoint("https://example.com", 42)).toBe(
      "https://example.com/wp-json/wp/v2/posts/42",
    );
  });

  it("ignores wpPostId=0 (falsy → no path segment)", () => {
    expect(buildWordPressPostsEndpoint("https://example.com", 0)).toBe(
      "https://example.com/wp-json/wp/v2/posts",
    );
  });
});

describe("buildBasicAuthHeader", () => {
  it("base64-encodes username:password with Basic prefix", () => {
    expect(buildBasicAuthHeader("wpuser", "secret")).toBe(
      `Basic ${Buffer.from("wpuser:secret").toString("base64")}`,
    );
  });

  it("strips whitespace from the application password", () => {
    expect(buildBasicAuthHeader("wpuser", "abcd efgh ijkl mnop")).toBe(
      `Basic ${Buffer.from("wpuser:abcdefghijklmnop").toString("base64")}`,
    );
  });
});

describe("PublishArticleError", () => {
  it("captures the code and details", () => {
    const e = new PublishArticleError("wp_request_failed", "500 oops");
    expect(e.code).toBe("wp_request_failed");
    expect(e.details).toBe("500 oops");
    expect(e.message).toContain("wp_request_failed");
    expect(e.message).toContain("500 oops");
  });

  it("renders without details when none provided", () => {
    const e = new PublishArticleError("article_not_found");
    expect(e.message).toBe("publish_article_error:article_not_found");
  });
});

// ============================================================================
// publishArticleToWordPressDraft (create new draft)
// ============================================================================

describe("publishArticleToWordPressDraft", () => {
  it("falls back to the admin client when none is passed", async () => {
    const { client } = makeClient();
    mockedCreateAdmin.mockReturnValue(client);
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse());

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      fetchImpl: fetchImpl as never,
    });

    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });

  it("throws article_not_found when the article query returns null", async () => {
    const { client } = makeClient({ articleReads: [null] });
    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ code: "article_not_found" });
  });

  it("throws blog_not_found when the blog query returns null", async () => {
    const { client } = makeClient({ blog: null });
    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ code: "blog_not_found" });
  });

  it("throws no_wp_connection when WP credentials are missing", async () => {
    const { client } = makeClient({
      blog: { wp_url: null, wp_username: null, wp_app_password: null },
    });
    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ code: "no_wp_connection" });
  });

  it("throws no_wp_connection when only the password is missing", async () => {
    const { client } = makeClient({
      blog: { ...defaultBlog, wp_app_password: "" },
    });
    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ code: "no_wp_connection" });
  });

  it("throws empty_article_body when content_markdown is null", async () => {
    const { client } = makeClient({
      articleReads: [{ ...defaultArticle, content_markdown: null }],
    });
    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ code: "empty_article_body" });
  });

  it("throws empty_article_body when content_markdown is whitespace", async () => {
    const { client } = makeClient({
      articleReads: [{ ...defaultArticle, content_markdown: "   \n   " }],
    });
    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ code: "empty_article_body" });
  });

  it("throws empty_article_body when sanitizer reduces body to empty HTML", async () => {
    mockedMarkdownToHtml.mockResolvedValueOnce("   ");
    const { client } = makeClient();
    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ code: "empty_article_body" });
  });

  it("posts the expected payload + headers to /wp-json/wp/v2/posts", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeOkResponse({ id: 42, link: "https://example.com/?p=42" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://example.com/wp-json/wp/v2/posts");
    expect(options.method).toBe("POST");
    const headers = options.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("application/json");
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("wpuser:abcdefghijklmnop").toString("base64")}`,
    );
    const body = JSON.parse(options.body as string);
    expect(body).toEqual({
      title: "Hello WP",
      content: "<h1>Body</h1><p>Hello world.</p>",
      status: "draft",
      excerpt: "An excerpt.",
      slug: "hello-wp",
    });
  });

  it("sends an empty excerpt when both excerpt and meta_description are blank", async () => {
    const { client } = makeClient({
      articleReads: [
        { ...defaultArticle, excerpt: "", meta_description: null },
      ],
    });
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse());

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(body.excerpt).toBe("");
  });

  it("falls back to meta_description for excerpt when excerpt is blank", async () => {
    const { client } = makeClient({
      articleReads: [{ ...defaultArticle, excerpt: "" }],
    });
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse());

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(body.excerpt).toBe("A meta description.");
  });

  it("omits slug from the payload when blank", async () => {
    const { client } = makeClient({
      articleReads: [{ ...defaultArticle, slug: null }],
    });
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse());

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(body.slug).toBeUndefined();
  });

  it("omits whitespace-only slug from the payload", async () => {
    const { client } = makeClient({
      articleReads: [{ ...defaultArticle, slug: "   " }],
    });
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse());

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(body.slug).toBeUndefined();
  });

  it("returns the wpPostId + wpPostUrl on success and stamps the article row", async () => {
    const { client, recordedUpdates } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeOkResponse({ id: 99, link: "https://example.com/?p=99" }),
      );

    const result = await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(result).toEqual({
      wpPostId: 99,
      wpPostUrl: "https://example.com/?p=99",
      status: "draft",
    });
    expect(recordedUpdates).toEqual([
      {
        wp_post_url: "https://example.com/?p=99",
        wp_post_id: 99,
      },
    ]);
  });

  it("returns wpPostUrl=null when the WP response has no link", async () => {
    const { client } = makeClient();
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse({ id: 1 }));

    const result = await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(result.wpPostUrl).toBeNull();
  });

  it("returns wpPostUrl=null when the WP response link is blank", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeOkResponse({ id: 1, link: "" }));

    const result = await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(result.wpPostUrl).toBeNull();
  });

  it("translates fetch network errors into wp_request_failed", async () => {
    const { client } = makeClient();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "wp_request_failed",
      details: "ECONNRESET",
    });
  });

  it("translates non-Error fetch failures into wp_request_failed with default detail", async () => {
    const { client } = makeClient();
    const fetchImpl = vi.fn().mockRejectedValue("oops");

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "wp_request_failed",
      details: "network_error",
    });
  });

  it("translates non-2xx WP responses into wp_request_failed with status text", async () => {
    const { client } = makeClient();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('{"code":"rest_cannot_create"}'),
    });

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "wp_request_failed",
      details: expect.stringContaining("401 Unauthorized"),
    });
  });

  it("does NOT translate 404 on POST into wp_post_not_found (config issue, not deletion)", async () => {
    const { client } = makeClient();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: vi.fn(),
      text: vi.fn().mockResolvedValue(""),
    });

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: "wp_request_failed" });
  });

  it("includes WP body in the failure detail (truncated to 500 chars)", async () => {
    const { client } = makeClient();
    const longBody = "x".repeat(700);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: vi.fn(),
      text: vi.fn().mockResolvedValue(longBody),
    });

    let caught: PublishArticleError | undefined;
    try {
      await publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      });
    } catch (e) {
      caught = e as PublishArticleError;
    }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe("wp_request_failed");
    expect(caught!.details!.length).toBeLessThanOrEqual(
      "500 Server Error ".length + 500,
    );
  });

  it("treats failure to read the WP error body as still a wp_request_failed", async () => {
    const { client } = makeClient();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: vi.fn(),
      text: vi.fn().mockRejectedValue(new Error("body already read")),
    });

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "wp_request_failed",
      details: expect.stringContaining("502 Bad Gateway"),
    });
  });

  it("translates invalid JSON response into wp_invalid_response", async () => {
    const { client } = makeClient();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: "Created",
      json: vi.fn().mockRejectedValue(new Error("Unexpected token")),
      text: vi.fn().mockResolvedValue(""),
    });

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "wp_invalid_response",
      details: "Unexpected token",
    });
  });

  it("uses default invalid_json detail when JSON parse rejects with non-Error", async () => {
    const { client } = makeClient();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: "Created",
      json: vi.fn().mockRejectedValue("nope"),
      text: vi.fn().mockResolvedValue(""),
    });

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "wp_invalid_response",
      details: "invalid_json",
    });
  });

  it("rejects WP responses that aren't an object", async () => {
    const { client } = makeClient();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: "Created",
      json: vi.fn().mockResolvedValue("hi"),
      text: vi.fn().mockResolvedValue(""),
    });

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: "wp_invalid_response" });
  });

  it("rejects WP responses with a missing or non-positive id", async () => {
    const { client } = makeClient();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: "Created",
      json: vi.fn().mockResolvedValue({ id: 0 }),
      text: vi.fn().mockResolvedValue(""),
    });

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "wp_invalid_response",
      details: expect.stringContaining("id"),
    });
  });

  it("propagates Supabase article SELECT errors as-is", async () => {
    const { client } = makeClient({
      articleReads: [null],
      articleReadErrors: [{ message: "boom" }],
    });

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ message: "boom" });
  });

  it("propagates Supabase blog SELECT errors as-is", async () => {
    const { client } = makeClient({
      blog: null,
      blogError: { message: "blog boom" },
    });

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ message: "blog boom" });
  });

  it("propagates Supabase UPDATE errors after a successful WP request", async () => {
    const { client } = makeClient({
      articleUpdateErrors: [{ message: "update boom" }],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeOkResponse({ id: 1, link: "https://example.com" }),
      );

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ message: "update boom" });
  });

  it("uses globalThis.fetch when no fetchImpl is provided", async () => {
    const { client } = makeClient();
    const realFetch = globalThis.fetch;
    const stubbed = vi
      .fn()
      .mockResolvedValue(
        makeOkResponse({ id: 1, link: "https://example.com" }),
      );
    globalThis.fetch = stubbed as never;
    try {
      await publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
      });
      expect(stubbed).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// ============================================================================
// updateArticleWordPressDraft (PUT existing draft, status="draft")
// ============================================================================

describe("updateArticleWordPressDraft", () => {
  const articleWithWp: ArticleRow = { ...defaultArticle, wp_post_id: 7 };

  it("throws wp_post_id_required when the article has no existing wp_post_id", async () => {
    const { client } = makeClient(); // default article has wp_post_id=null
    await expect(
      updateArticleWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ code: "wp_post_id_required" });
  });

  it("PUTs to /wp-json/wp/v2/posts/{wp_post_id} with status=draft", async () => {
    const { client } = makeClient({ articleReads: [articleWithWp] });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await updateArticleWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://example.com/wp-json/wp/v2/posts/7");
    expect(options.method).toBe("PUT");
    const body = JSON.parse(options.body as string);
    expect(body.status).toBe("draft");
    expect(body.title).toBe("Hello WP");
    expect(body.content).toBe("<h1>Body</h1><p>Hello world.</p>");
  });

  it("calls the markdown converter with the latest content", async () => {
    const { client } = makeClient({
      articleReads: [{ ...articleWithWp, content_markdown: "Edited body." }],
    });
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse({ id: 7 }));

    await updateArticleWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(mockedMarkdownToHtml).toHaveBeenCalledWith("Edited body.", {
      sectionImagesByKey: {},
    });
  });

  it("refreshes wp_post_url from the response but DOES NOT touch wp_post_id or status", async () => {
    const { client, recordedUpdates } = makeClient({
      articleReads: [articleWithWp],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7&v=2" }),
      );

    const result = await updateArticleWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(result).toEqual({
      wpPostId: 7,
      wpPostUrl: "https://example.com/?p=7&v=2",
      wpStatus: "draft",
      publishedLocally: false,
    });
    expect(recordedUpdates).toEqual([
      { wp_post_url: "https://example.com/?p=7&v=2" },
    ]);
  });

  it("translates a 404 from WordPress into wp_post_not_found", async () => {
    const { client } = makeClient({ articleReads: [articleWithWp] });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('{"code":"rest_post_invalid_id"}'),
    });

    await expect(
      updateArticleWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "wp_post_not_found",
      details: expect.stringContaining("404 Not Found"),
    });
  });

  it("falls back to admin client when none is passed", async () => {
    const { client } = makeClient({ articleReads: [articleWithWp] });
    mockedCreateAdmin.mockReturnValue(client);
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse({ id: 7 }));

    await updateArticleWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      fetchImpl: fetchImpl as never,
    });

    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });

  it("still validates connection / body before calling WP", async () => {
    const { client } = makeClient({
      articleReads: [{ ...articleWithWp, content_markdown: null }],
    });
    await expect(
      updateArticleWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ code: "empty_article_body" });
  });
});

// ============================================================================
// publishArticleToWordPressLive (PUT existing post, status="publish")
// ============================================================================

describe("publishArticleToWordPressLive", () => {
  const articleWithWp: ArticleRow = { ...defaultArticle, wp_post_id: 7 };

  it("throws wp_post_id_required when wp_post_id is null", async () => {
    const { client } = makeClient();
    await expect(
      publishArticleToWordPressLive({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ code: "wp_post_id_required" });
  });

  it("PUTs to /wp-json/wp/v2/posts/{wp_post_id} with status=publish", async () => {
    const { client } = makeClient({
      articleReads: [articleWithWp, { published_at: null }],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressLive({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://example.com/wp-json/wp/v2/posts/7");
    expect(options.method).toBe("PUT");
    const body = JSON.parse(options.body as string);
    expect(body.status).toBe("publish");
  });

  it("transitions the local article to status=published and stamps published_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T10:00:00Z"));
    try {
      const { client, recordedUpdates } = makeClient({
        articleReads: [articleWithWp, { published_at: null }],
      });
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
        );

      const result = await publishArticleToWordPressLive({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      });

      expect(result).toEqual({
        wpPostId: 7,
        wpPostUrl: "https://example.com/?p=7",
        wpStatus: "publish",
        publishedLocally: true,
      });
      expect(recordedUpdates).toEqual([
        {
          wp_post_url: "https://example.com/?p=7",
          status: "published",
          published_at: "2026-05-12T10:00:00.000Z",
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the original published_at on a re-publish (Update Live Post)", async () => {
    const original = "2025-01-01T00:00:00.000Z";
    const { client, recordedUpdates } = makeClient({
      articleReads: [articleWithWp, { published_at: original }],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressLive({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(recordedUpdates).toEqual([
      {
        wp_post_url: "https://example.com/?p=7",
        status: "published",
      },
    ]);
    expect(recordedUpdates[0]).not.toHaveProperty("published_at");
  });

  it("stamps published_at when the published_at SELECT returns null row (defensive)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    try {
      const { client, recordedUpdates } = makeClient({
        articleReads: [articleWithWp, null],
      });
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
        );

      await publishArticleToWordPressLive({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      });

      expect(recordedUpdates[0]!.published_at).toBe("2026-06-01T12:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("translates a 404 from WordPress into wp_post_not_found", async () => {
    const { client } = makeClient({ articleReads: [articleWithWp] });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: vi.fn(),
      text: vi.fn().mockResolvedValue(""),
    });

    await expect(
      publishArticleToWordPressLive({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: "wp_post_not_found" });
  });

  it("does not touch the article row when the WP request fails", async () => {
    const { client, recordedUpdates } = makeClient({
      articleReads: [articleWithWp],
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: vi.fn(),
      text: vi.fn().mockResolvedValue(""),
    });

    await expect(
      publishArticleToWordPressLive({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: "wp_request_failed" });
    expect(recordedUpdates).toEqual([]);
  });

  it("still uses the markdown→html→sanitize pipeline for publish_live", async () => {
    const { client } = makeClient({
      articleReads: [articleWithWp, { published_at: null }],
    });
    mockedMarkdownToHtml.mockResolvedValueOnce("<p>Sanitized output</p>");
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeOkResponse({ id: 7, link: "https://example.com" }),
      );

    await publishArticleToWordPressLive({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(mockedMarkdownToHtml).toHaveBeenCalledWith(
      articleWithWp.content_markdown,
      { sectionImagesByKey: {} },
    );
    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(body.content).toBe("<p>Sanitized output</p>");
  });
});

// ============================================================================
// clearWordPressLink
// ============================================================================

describe("clearWordPressLink", () => {
  it("nulls wp_post_id + wp_post_url on the targeted article", async () => {
    const { client, recordedUpdates } = makeClient();

    await clearWordPressLink({
      articleId: "a1",
      blogId: "b1",
      client,
    });

    expect(recordedUpdates).toEqual([{ wp_post_id: null, wp_post_url: null }]);
  });

  it("falls back to the admin client when none is passed", async () => {
    const { client } = makeClient();
    mockedCreateAdmin.mockReturnValue(client);

    await clearWordPressLink({ articleId: "a1", blogId: "b1" });

    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });

  it("propagates Supabase UPDATE errors as-is", async () => {
    const { client } = makeClient({
      articleUpdateErrors: [{ message: "boom" }],
    });

    await expect(
      clearWordPressLink({ articleId: "a1", blogId: "b1", client }),
    ).rejects.toMatchObject({ message: "boom" });
  });
});

// ============================================================================
// buildWordPressMediaEndpoint
// ============================================================================

describe("buildWordPressMediaEndpoint", () => {
  it("returns the collection endpoint when no id is given", () => {
    expect(buildWordPressMediaEndpoint("https://example.com")).toBe(
      "https://example.com/wp-json/wp/v2/media",
    );
  });

  it("returns the single-resource endpoint when an id is given", () => {
    expect(buildWordPressMediaEndpoint("https://example.com", 42)).toBe(
      "https://example.com/wp-json/wp/v2/media/42",
    );
  });

  it("strips trailing slashes from the site URL", () => {
    expect(buildWordPressMediaEndpoint("https://example.com///")).toBe(
      "https://example.com/wp-json/wp/v2/media",
    );
  });
});

// ============================================================================
// uploadMediaToWordPress (public helper)
// ============================================================================

/**
 * Builds a fake `Response`-shaped object for the image-fetch leg.
 * Returns binary bytes + a `content-type` header of the requested
 * type. We don't need a real Response — the helper only calls
 * `headers.get()`, `arrayBuffer()`, `ok`, `status`, `statusText`,
 * `text()`.
 */
function makeImageResponse(
  opts: {
    contentType?: string;
    bytes?: ArrayBuffer;
    ok?: boolean;
    status?: number;
    statusText?: string;
  } = {},
) {
  const headers = new Headers({
    "content-type": opts.contentType ?? "image/png",
  });
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? "OK",
    headers,
    arrayBuffer: vi.fn().mockResolvedValue(opts.bytes ?? new ArrayBuffer(8)),
    text: vi.fn().mockResolvedValue(""),
  };
}

function makeMediaUploadResponse(
  body: { id: number; source_url?: string | null; alt_text?: string | null } = {
    id: 99,
    source_url: "https://example.com/wp-content/uploads/img.png",
  },
) {
  return {
    ok: true,
    status: 201,
    statusText: "Created",
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(""),
  };
}

describe("uploadMediaToWordPress", () => {
  it("fetches the image, POSTs to /wp-json/wp/v2/media, and returns the id + source_url", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      .mockResolvedValueOnce(
        makeMediaUploadResponse({
          id: 99,
          source_url: "https://example.com/uploads/x.png",
        }),
      );

    const result = await uploadMediaToWordPress({
      blogId: "b1",
      imageUrl: "https://cdn.example.com/x.png",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(result).toEqual({
      mediaId: 99,
      sourceUrl: "https://example.com/uploads/x.png",
      altText: null,
    });

    // First call: image fetch.
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://cdn.example.com/x.png");

    // Second call: WP POST.
    const [uploadUrl, uploadOpts] = fetchImpl.mock.calls[1]!;
    expect(uploadUrl).toBe("https://example.com/wp-json/wp/v2/media");
    expect(uploadOpts.method).toBe("POST");
    expect(uploadOpts.headers["Content-Type"]).toBe("image/png");
    expect(uploadOpts.headers["Content-Disposition"]).toBe(
      'attachment; filename="x.png"',
    );
    expect(uploadOpts.headers.Authorization).toBe(
      `Basic ${Buffer.from("wpuser:abcdefghijklmnop").toString("base64")}`,
    );
  });

  it("PUTs alt_text via the single-media endpoint when altText is provided", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/jpeg" }))
      .mockResolvedValueOnce(
        makeMediaUploadResponse({
          id: 42,
          source_url: "https://example.com/uploads/y.jpg",
          alt_text: "",
        }),
      )
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const result = await uploadMediaToWordPress({
      blogId: "b1",
      imageUrl: "https://cdn.example.com/y.jpg",
      altText: "  A photo of a cat  ",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(result.altText).toBe("A photo of a cat");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [putUrl, putOpts] = fetchImpl.mock.calls[2]!;
    expect(putUrl).toBe("https://example.com/wp-json/wp/v2/media/42");
    expect(putOpts.method).toBe("PUT");
    expect(JSON.parse(putOpts.body as string)).toEqual({
      alt_text: "A photo of a cat",
    });
  });

  it("skips the alt-text PUT when WordPress already echoed back the same alt", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse())
      .mockResolvedValueOnce(
        makeMediaUploadResponse({
          id: 1,
          source_url: null,
          alt_text: "Already set",
        }),
      );

    await uploadMediaToWordPress({
      blogId: "b1",
      imageUrl: "https://cdn.example.com/x.png",
      altText: "Already set",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("derives the filename from the source URL path when present", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      .mockResolvedValueOnce(makeMediaUploadResponse());

    await uploadMediaToWordPress({
      blogId: "b1",
      imageUrl: "https://cdn.example.com/foo/bar.png?v=1",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl.mock.calls[1]![1].headers["Content-Disposition"]).toBe(
      'attachment; filename="bar.png"',
    );
  });

  it("falls back to a content-type-derived filename when the URL has no extension", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/jpeg" }))
      .mockResolvedValueOnce(makeMediaUploadResponse());

    await uploadMediaToWordPress({
      blogId: "b1",
      imageUrl: "https://cdn.example.com/share?token=abc",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl.mock.calls[1]![1].headers["Content-Disposition"]).toBe(
      'attachment; filename="featured-image.jpeg"',
    );
  });

  it("falls back to a content-type-derived filename when the URL has only a root path", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      .mockResolvedValueOnce(makeMediaUploadResponse());

    // `new URL("https://cdn.example.com/").pathname` is "/", which the
    // `split + filter(Boolean) + pop()` reduces to undefined → exercises
    // the `?? ""` fallback in deriveFilename.
    await uploadMediaToWordPress({
      blogId: "b1",
      imageUrl: "https://cdn.example.com/",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl.mock.calls[1]![1].headers["Content-Disposition"]).toBe(
      'attachment; filename="featured-image.png"',
    );
  });

  it("falls back to a 'bin' extension when content-type has no subtype", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/" }))
      .mockResolvedValueOnce(makeMediaUploadResponse());

    await uploadMediaToWordPress({
      blogId: "b1",
      imageUrl: "https://cdn.example.com/share?token=abc",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl.mock.calls[1]![1].headers["Content-Disposition"]).toBe(
      'attachment; filename="featured-image.bin"',
    );
  });

  it("sanitizes filename characters that would break Content-Disposition", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      .mockResolvedValueOnce(makeMediaUploadResponse());

    await uploadMediaToWordPress({
      blogId: "b1",
      imageUrl: "https://cdn.example.com/silly%20name.png",
      filename: 'evil"; injected.png',
      client,
      fetchImpl: fetchImpl as never,
    });

    // `evil"; injected.png` has three unsafe chars (quote, semicolon,
    // space) — sanitizer replaces each with `_`.
    expect(fetchImpl.mock.calls[1]![1].headers["Content-Disposition"]).toBe(
      'attachment; filename="evil___injected.png"',
    );
  });

  it("uses an explicit filename override when provided", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      .mockResolvedValueOnce(makeMediaUploadResponse());

    await uploadMediaToWordPress({
      blogId: "b1",
      imageUrl: "https://cdn.example.com/foo.png",
      filename: "my-image.png",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl.mock.calls[1]![1].headers["Content-Disposition"]).toBe(
      'attachment; filename="my-image.png"',
    );
  });

  it("returns sourceUrl=null when WordPress responds without source_url", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse())
      .mockResolvedValueOnce(makeMediaUploadResponse({ id: 5 }));

    const result = await uploadMediaToWordPress({
      blogId: "b1",
      imageUrl: "https://cdn.example.com/x.png",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(result.sourceUrl).toBeNull();
  });

  it("throws blog_not_found when the blog row is missing", async () => {
    const { client } = makeClient({ blog: null });
    await expect(
      uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x.png",
        client,
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ code: "blog_not_found" });
  });

  it("throws no_wp_connection when the credentials aren't set", async () => {
    const { client } = makeClient({
      blog: { wp_url: null, wp_username: null, wp_app_password: null },
    });
    await expect(
      uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x.png",
        client,
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ code: "no_wp_connection" });
  });

  it("translates fetch network errors to image_fetch_failed", async () => {
    const { client } = makeClient();
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(
      uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x.png",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "image_fetch_failed",
      details: "ECONNRESET",
    });
  });

  it("translates non-Error fetch failures to image_fetch_failed with default detail", async () => {
    const { client } = makeClient();
    const fetchImpl = vi.fn().mockRejectedValueOnce("oops");
    await expect(
      uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x.png",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "image_fetch_failed",
      details: "network_error",
    });
  });

  it("translates non-2xx image fetches to image_fetch_failed with status", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        makeImageResponse({ ok: false, status: 404, statusText: "Not Found" }),
      );
    await expect(
      uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x.png",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "image_fetch_failed",
      details: "404 Not Found",
    });
  });

  it("rejects responses whose Content-Type isn't image/*", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "text/html" }));
    await expect(
      uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x.html",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "image_invalid_content_type",
      details: "text/html",
    });
  });

  it("rejects responses with no Content-Type header at all", async () => {
    const { client } = makeClient();
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      text: vi.fn().mockResolvedValue(""),
    });
    await expect(
      uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "image_invalid_content_type",
      details: "missing",
    });
  });

  it("translates network errors during the WP upload leg to wp_media_upload_failed", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse())
      .mockRejectedValueOnce(new Error("EHOSTUNREACH"));
    await expect(
      uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x.png",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "wp_media_upload_failed",
      details: "EHOSTUNREACH",
    });
  });

  it("translates non-Error WP upload failures to wp_media_upload_failed with default detail", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse())
      .mockRejectedValueOnce("nope");
    await expect(
      uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x.png",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "wp_media_upload_failed",
      details: "network_error",
    });
  });

  it("translates non-2xx WP upload responses to wp_media_upload_failed with truncated body", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse())
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: vi.fn(),
        text: vi.fn().mockResolvedValue('{"code":"rest_forbidden"}'),
      });
    await expect(
      uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x.png",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "wp_media_upload_failed",
      details: expect.stringContaining("401 Unauthorized"),
    });
  });

  it("treats failure to read the WP error body as still a wp_media_upload_failed", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse())
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: vi.fn(),
        text: vi.fn().mockRejectedValue(new Error("body already read")),
      });
    await expect(
      uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x.png",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "wp_media_upload_failed",
      details: expect.stringContaining("502 Bad Gateway"),
    });
  });

  it("translates invalid JSON in the WP media response to wp_invalid_media_response", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse())
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: "Created",
        json: vi.fn().mockRejectedValue(new Error("Unexpected token")),
        text: vi.fn().mockResolvedValue(""),
      });
    await expect(
      uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x.png",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "wp_invalid_media_response",
      details: "Unexpected token",
    });
  });

  it("uses 'invalid_json' as the default detail for non-Error JSON parse failures", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse())
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: "Created",
        json: vi.fn().mockRejectedValue("nope"),
        text: vi.fn().mockResolvedValue(""),
      });
    await expect(
      uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x.png",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "wp_invalid_media_response",
      details: "invalid_json",
    });
  });

  it("rejects WP media responses missing a positive id", async () => {
    const { client } = makeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse())
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: "Created",
        json: vi.fn().mockResolvedValue({ source_url: "x" }),
        text: vi.fn().mockResolvedValue(""),
      });
    await expect(
      uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x.png",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: "wp_invalid_media_response" });
  });

  it("falls back to globalThis.fetch when no fetchImpl is provided", async () => {
    const { client } = makeClient();
    const realFetch = globalThis.fetch;
    const stubbed = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse())
      .mockResolvedValueOnce(makeMediaUploadResponse());
    globalThis.fetch = stubbed as never;
    try {
      await uploadMediaToWordPress({
        blogId: "b1",
        imageUrl: "https://cdn.example.com/x.png",
        client,
      });
      expect(stubbed).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("falls back to the admin client when none is injected", async () => {
    const { client } = makeClient();
    mockedCreateAdmin.mockReturnValue(client);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse())
      .mockResolvedValueOnce(makeMediaUploadResponse());

    await uploadMediaToWordPress({
      blogId: "b1",
      imageUrl: "https://cdn.example.com/x.png",
      fetchImpl: fetchImpl as never,
    });

    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Featured-image integration with the publish helpers
// ============================================================================

describe("featured-image integration with syncArticleToWordPress", () => {
  it("uploads the featured image when wp_featured_media_id is missing, then includes featured_media in the post", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      featured_image_url: "https://cdn.example.com/x.png",
      featured_image_alt: "A photo",
      wp_featured_media_id: null,
    };
    const { client, recordedUpdates } = makeClient({
      articleReads: [articleWithImage],
    });
    const fetchImpl = vi
      .fn()
      // 1. image fetch
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      // 2. WP media POST
      .mockResolvedValueOnce(
        makeMediaUploadResponse({
          id: 99,
          source_url: "https://example.com/uploads/x.png",
        }),
      )
      // 3. alt-text PUT
      .mockResolvedValueOnce({ ok: true, status: 200 })
      // 4. WP posts POST (the article itself)
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    // The article post payload includes the freshly-uploaded id.
    const postBody = JSON.parse(fetchImpl.mock.calls[3]![1].body as string);
    expect(postBody.featured_media).toBe(99);

    // The cached wp_featured_media_id was written to the row before
    // the post UPDATE, so we expect it in `recordedUpdates`.
    const cacheUpdate = recordedUpdates.find(
      (u) => "wp_featured_media_id" in u,
    );
    expect(cacheUpdate).toEqual({ wp_featured_media_id: 99 });
  });

  it("uses an SEO-friendly Content-Disposition filename derived from alt → keyword → title", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      title: "Modern smart home setup",
      target_keyword: "smart home cameras",
      featured_image_url: "https://images.unsplash.com/photo-abc?w=1200",
      featured_image_alt: "Modern video doorbell on front porch",
      wp_featured_media_id: null,
    };
    const { client } = makeClient({ articleReads: [articleWithImage] });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/jpeg" }))
      .mockResolvedValueOnce(makeMediaUploadResponse({ id: 99 }))
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    // Second call is the WP media POST; assert the filename comes
    // from the alt text + jpg extension (mapped from image/jpeg).
    const uploadHeaders = fetchImpl.mock.calls[1]![1].headers as Record<
      string,
      string
    >;
    expect(uploadHeaders["Content-Disposition"]).toBe(
      'attachment; filename="modern-video-doorbell-on-front-porch.jpg"',
    );
  });

  it("falls back to the target keyword in the upload filename when alt text is missing", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      title: "Modern smart home setup",
      target_keyword: "best smart locks for apartments",
      featured_image_url: "https://images.unsplash.com/photo-abc",
      featured_image_alt: null,
      wp_featured_media_id: null,
    };
    const { client } = makeClient({ articleReads: [articleWithImage] });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/webp" }))
      .mockResolvedValueOnce(makeMediaUploadResponse({ id: 100 }))
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const uploadHeaders = fetchImpl.mock.calls[1]![1].headers as Record<
      string,
      string
    >;
    expect(uploadHeaders["Content-Disposition"]).toBe(
      'attachment; filename="best-smart-locks-for-apartments.webp"',
    );
  });

  it("falls back to the article title when alt + keyword are missing", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      title: "How Home Security Cameras Work",
      target_keyword: null,
      featured_image_url: "https://images.unsplash.com/photo-abc",
      featured_image_alt: null,
      wp_featured_media_id: null,
    };
    const { client } = makeClient({ articleReads: [articleWithImage] });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      .mockResolvedValueOnce(makeMediaUploadResponse({ id: 101 }))
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const uploadHeaders = fetchImpl.mock.calls[1]![1].headers as Record<
      string,
      string
    >;
    expect(uploadHeaders["Content-Disposition"]).toBe(
      'attachment; filename="how-home-security-cameras-work.png"',
    );
  });

  it("reuses the cached wp_featured_media_id without re-uploading", async () => {
    const articleWithCachedMedia: ArticleRow = {
      ...defaultArticle,
      featured_image_url: "https://cdn.example.com/x.png",
      featured_image_alt: null,
      wp_featured_media_id: 99,
    };
    const { client } = makeClient({
      articleReads: [articleWithCachedMedia],
    });
    const fetchImpl = vi
      .fn()
      // Only the WP posts POST should fire — no media calls.
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const postBody = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(postBody.featured_media).toBe(99);
  });

  it("omits featured_media from the payload when no featured image is configured", async () => {
    const { client } = makeClient(); // defaultArticle has no image
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const postBody = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(postBody.featured_media).toBeUndefined();
  });

  it("propagates image_fetch_failed and never sends the post", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      featured_image_url: "https://cdn.example.com/x.png",
      featured_image_alt: null,
      wp_featured_media_id: null,
    };
    const { client } = makeClient({ articleReads: [articleWithImage] });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        makeImageResponse({ ok: false, status: 404, statusText: "Not Found" }),
      );

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: "image_fetch_failed" });

    // We never reached the article POST.
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("propagates image_invalid_content_type when the fetched URL isn't an image", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      featured_image_url: "https://cdn.example.com/x.html",
      featured_image_alt: null,
      wp_featured_media_id: null,
    };
    const { client } = makeClient({ articleReads: [articleWithImage] });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "text/html" }));

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: "image_invalid_content_type" });
  });

  it("propagates wp_media_upload_failed when WordPress rejects the upload", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      featured_image_url: "https://cdn.example.com/x.png",
      featured_image_alt: null,
      wp_featured_media_id: null,
    };
    const { client } = makeClient({ articleReads: [articleWithImage] });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse())
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: vi.fn(),
        text: vi.fn().mockResolvedValue(""),
      });

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: "wp_media_upload_failed" });
  });

  it("uploads + includes featured_media on update_draft when wp_featured_media_id is missing", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      wp_post_id: 7,
      featured_image_url: "https://cdn.example.com/x.png",
      featured_image_alt: null,
      wp_featured_media_id: null,
    };
    const { client } = makeClient({ articleReads: [articleWithImage] });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse())
      .mockResolvedValueOnce(
        makeMediaUploadResponse({
          id: 55,
          source_url: "https://example.com/uploads/x.png",
        }),
      )
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await updateArticleWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const putUrl = fetchImpl.mock.calls[2]![0];
    expect(putUrl).toBe("https://example.com/wp-json/wp/v2/posts/7");
    const putBody = JSON.parse(fetchImpl.mock.calls[2]![1].body as string);
    expect(putBody.featured_media).toBe(55);
    expect(putBody.status).toBe("draft");
  });

  it("includes featured_media on publish_live without re-uploading when cached", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      wp_post_id: 7,
      featured_image_url: "https://cdn.example.com/x.png",
      featured_image_alt: null,
      wp_featured_media_id: 99,
    };
    const { client } = makeClient({
      articleReads: [articleWithImage, { published_at: null }],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressLive({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const putBody = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(putBody.featured_media).toBe(99);
    expect(putBody.status).toBe("publish");
  });
});

// ============================================================================
// Post-upload Unsplash bookkeeping (download_location + wp_media_id stamp)
// ============================================================================

const ORIGINAL_UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;

describe("post-upload Unsplash bookkeeping", () => {
  beforeEach(() => {
    process.env.UNSPLASH_ACCESS_KEY = "test-unsplash-key";
  });

  afterAll(() => {
    if (ORIGINAL_UNSPLASH_KEY === undefined) {
      delete process.env.UNSPLASH_ACCESS_KEY;
    } else {
      process.env.UNSPLASH_ACCESS_KEY = ORIGINAL_UNSPLASH_KEY;
    }
  });

  function makeAttributionRow(
    overrides: Partial<ImageUploadRowFixture> = {},
  ): ImageUploadRowFixture {
    return {
      id: "img-row-1",
      article_id: "a1",
      blog_id: "b1",
      provider: "unsplash",
      provider_photo_id: "abc",
      image_url: "https://cdn.example.com/x.png",
      alt_text: "A photo",
      photographer_name: "Annie Spratt",
      photographer_profile_url: "https://unsplash.com/@anniespratt",
      photo_url: "https://unsplash.com/photos/abc",
      download_location: "https://api.unsplash.com/photos/abc/download",
      wp_media_id: null,
      role: "featured",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };
  }

  it("fires the Unsplash download tracker GET after a successful WP upload", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      featured_image_url: "https://cdn.example.com/x.png",
      featured_image_alt: "A photo",
      wp_featured_media_id: null,
    };
    const { client, recordedImageUploadUpdates } = makeClient({
      articleReads: [articleWithImage],
      activeImageUpload: makeAttributionRow(),
    });
    const fetchImpl = vi
      .fn()
      // 1. image fetch
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      // 2. WP media POST
      .mockResolvedValueOnce(makeMediaUploadResponse({ id: 99 }))
      // 3. WP media PUT (alt text patch — fires because alt is set)
      .mockResolvedValueOnce({ ok: true, status: 200 })
      // 4. Unsplash download tracker
      .mockResolvedValueOnce({ ok: true, status: 200 })
      // 5. WP posts POST
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    // The download tracker request landed at the right URL with
    // Client-ID auth.
    const trackerCall = fetchImpl.mock.calls.find(
      ([url]) => url === "https://api.unsplash.com/photos/abc/download",
    );
    expect(trackerCall).toBeDefined();
    expect(trackerCall![1]!.method).toBe("GET");
    expect(trackerCall![1]!.headers.Authorization).toBe(
      "Client-ID test-unsplash-key",
    );

    // The attribution row got the wp_media_id stamped.
    expect(recordedImageUploadUpdates).toContainEqual({ wp_media_id: 99 });
  });

  it("does NOT fire the download tracker when the cached wp_featured_media_id is reused", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      featured_image_url: "https://cdn.example.com/x.png",
      featured_image_alt: "A photo",
      // Pre-cached id → ensureFeaturedMediaUploaded short-circuits
      // BEFORE the upload + bookkeeping runs.
      wp_featured_media_id: 99,
    };
    const { client } = makeClient({
      articleReads: [articleWithImage],
      activeImageUpload: makeAttributionRow({ wp_media_id: 99 }),
    });
    const fetchImpl = vi
      .fn()
      // Only the WP posts POST should fire — no media calls + no tracker.
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const trackerCall = fetchImpl.mock.calls.find(([url]) =>
      String(url).includes("/photos/abc/download"),
    );
    expect(trackerCall).toBeUndefined();
  });

  it("does NOT fire the download tracker when the attribution row is missing (manual paste)", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      featured_image_url: "https://cdn.example.com/manual.png",
      featured_image_alt: null,
      wp_featured_media_id: null,
    };
    const { client, recordedImageUploadUpdates } = makeClient({
      articleReads: [articleWithImage],
      activeImageUpload: null, // no attribution row for manual URLs
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      .mockResolvedValueOnce(makeMediaUploadResponse({ id: 99 }))
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const trackerCall = fetchImpl.mock.calls.find(([url]) =>
      String(url).includes("/photos/"),
    );
    expect(trackerCall).toBeUndefined();
    // No attribution row means nothing to stamp either.
    expect(recordedImageUploadUpdates).toEqual([]);
  });

  it("does NOT fire the download tracker for a non-Unsplash attribution row", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      featured_image_url: "https://cdn.example.com/x.png",
      featured_image_alt: null,
      wp_featured_media_id: null,
    };
    const { client, recordedImageUploadUpdates } = makeClient({
      articleReads: [articleWithImage],
      activeImageUpload: makeAttributionRow({
        provider: "manual_url",
        download_location: null,
      }),
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      .mockResolvedValueOnce(makeMediaUploadResponse({ id: 99 }))
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const trackerCall = fetchImpl.mock.calls.find(([url]) =>
      String(url).includes("/photos/"),
    );
    expect(trackerCall).toBeUndefined();
    // wp_media_id stamping still happens — useful for the
    // "recently used" cache regardless of provider.
    expect(recordedImageUploadUpdates).toContainEqual({ wp_media_id: 99 });
  });

  it("does NOT re-stamp wp_media_id when the row already has it", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      featured_image_url: "https://cdn.example.com/x.png",
      featured_image_alt: null,
      wp_featured_media_id: null, // article-level cache empty …
    };
    const { client, recordedImageUploadUpdates } = makeClient({
      articleReads: [articleWithImage],
      // … but the attribution row has the id (recently-used reuse path).
      activeImageUpload: makeAttributionRow({ wp_media_id: 99 }),
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      .mockResolvedValueOnce(makeMediaUploadResponse({ id: 99 }))
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    // The attribution row already had wp_media_id=99 → no re-stamp.
    expect(recordedImageUploadUpdates).toEqual([]);
  });

  it("does NOT fail the WordPress publish if the download tracker errors out", async () => {
    const articleWithImage: ArticleRow = {
      ...defaultArticle,
      featured_image_url: "https://cdn.example.com/x.png",
      featured_image_alt: null,
      wp_featured_media_id: null,
    };
    const { client } = makeClient({
      articleReads: [articleWithImage],
      activeImageUpload: makeAttributionRow(),
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      .mockResolvedValueOnce(makeMediaUploadResponse({ id: 99 }))
      // Tracker fails — should be swallowed.
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    const result = await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    expect(result.wpPostId).toBe(7);
  });
});

// ============================================================================
// Section image publishing (v6) — load rows, upload, inject HTML, attribution
// ============================================================================

const ORIGINAL_UNSPLASH_KEY_FOR_SECTIONS = process.env.UNSPLASH_ACCESS_KEY;

describe("section-image publishing with syncArticleToWordPress", () => {
  beforeEach(() => {
    process.env.UNSPLASH_ACCESS_KEY = "test-unsplash-key";
    // The featured-image integration tests above stubbed
    // markdownToHtml to return a static body so they could focus on
    // assertions other than HTML output. For section tests we want
    // the REAL markdownToHtml pipeline so we can verify that the
    // section image figure lands above the matching H2.
    mockedMarkdownToHtml.mockImplementation(async (md, options) => {
      // Re-import dynamically inside the mock so we don't accidentally
      // hold a stale module ref across test files.
      const real = await vi.importActual<typeof import("@/lib/markdown-to-html")>(
        "@/lib/markdown-to-html",
      );
      return real.markdownToHtml(md, options);
    });
  });
  afterAll(() => {
    if (ORIGINAL_UNSPLASH_KEY_FOR_SECTIONS === undefined) {
      delete process.env.UNSPLASH_ACCESS_KEY;
    } else {
      process.env.UNSPLASH_ACCESS_KEY = ORIGINAL_UNSPLASH_KEY_FOR_SECTIONS;
    }
  });

  const SECTION_BODY = "## Intro\n\nIntro body.\n\n## FAQ\n\nFAQ body.\n";

  function makeSectionRow(
    overrides: Partial<ImageUploadRowFixture> = {},
  ): ImageUploadRowFixture {
    return {
      id: "sec-row-1",
      article_id: "a1",
      blog_id: "b1",
      provider: "unsplash",
      provider_photo_id: "abc",
      image_url: "https://cdn.example.com/intro.png",
      alt_text: "Intro hero",
      photographer_name: "Annie Spratt",
      photographer_profile_url: "https://unsplash.com/@anniespratt",
      photo_url: "https://unsplash.com/photos/abc",
      download_location: "https://api.unsplash.com/photos/abc/download",
      wp_media_id: null,
      role: "section",
      section_key: "intro",
      section_heading: "Intro",
      sort_order: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // Loading + reuse semantics
  // -------------------------------------------------------------------------

  it("loads section image rows for the article and reuses cached wp_media_id (no upload)", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      content_markdown: SECTION_BODY,
    };
    const { client, recordedImageUploadUpdates } = makeClient({
      articleReads: [article],
      sectionImageRows: [
        makeSectionRow({ wp_media_id: 555 }), // cached → no upload
      ],
    });
    const fetchImpl = vi
      .fn()
      // Only the WP posts POST — no /media calls because of cache.
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    // Exactly one HTTP call: the post. No /media POST, no tracker GET.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain("/wp-json/wp/v2/posts");

    // No stamp write — the cache was already populated.
    expect(recordedImageUploadUpdates).toEqual([]);

    // Verify the published HTML includes the section image with the
    // wp-image-555 class (using the cached id).
    const postBody = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(postBody.content).toContain("wp-image-555");
    expect(postBody.content).toContain("https://cdn.example.com/intro.png");
  });

  it("uploads the section image when wp_media_id is missing, stamps the row, fires download tracker", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      content_markdown: SECTION_BODY,
    };
    const { client, recordedImageUploadUpdates } = makeClient({
      articleReads: [article],
      sectionImageRows: [makeSectionRow({ wp_media_id: null })],
    });
    const fetchImpl = vi
      .fn()
      // 1. image fetch (section image source)
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      // 2. WP media POST → returns the new attachment id + source_url
      .mockResolvedValueOnce(
        makeMediaUploadResponse({
          id: 777,
          source_url: "https://example.com/uploads/intro-hero.png",
        }),
      )
      // 3. alt-text PUT
      .mockResolvedValueOnce({ ok: true, status: 200 })
      // 4. Unsplash download tracker GET
      .mockResolvedValueOnce({ ok: true, status: 200 })
      // 5. WP posts POST (the article itself)
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    // 1: image, 2: media POST, 3: alt PUT, 4: tracker, 5: post.
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    const trackerCall = fetchImpl.mock.calls[3]!;
    expect(trackerCall[0]).toBe("https://api.unsplash.com/photos/abc/download");

    // wp_media_id was stamped on the section row.
    expect(recordedImageUploadUpdates).toContainEqual({ wp_media_id: 777 });

    // The published HTML references the WP source_url (preferred
    // over the original cdn URL) and the wp-image-777 class.
    const postBody = JSON.parse(fetchImpl.mock.calls[4]![1].body as string);
    expect(postBody.content).toContain("wp-image-777");
    expect(postBody.content).toContain(
      "https://example.com/uploads/intro-hero.png",
    );
    expect(postBody.content).not.toContain("https://cdn.example.com/intro.png");
  });

  it("falls back to the original image_url when WP omits source_url from the upload response", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      content_markdown: SECTION_BODY,
    };
    const { client } = makeClient({
      articleReads: [article],
      sectionImageRows: [
        makeSectionRow({
          wp_media_id: null,
          image_url: "https://cdn.example.com/original.png",
        }),
      ],
    });
    // Make a media-upload response that has NO source_url (null).
    // The upload helper returns sourceUrl=null in that case; our
    // SectionUploadResult code falls back to row.image_url.
    const mediaResponseWithoutSourceUrl = {
      ok: true,
      status: 201,
      statusText: "Created",
      json: vi.fn().mockResolvedValue({ id: 778 }),
      text: vi.fn().mockResolvedValue(""),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      .mockResolvedValueOnce(mediaResponseWithoutSourceUrl)
      .mockResolvedValueOnce({ ok: true, status: 200 }) // alt PUT
      .mockResolvedValueOnce({ ok: true, status: 200 }) // tracker
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const postBody = JSON.parse(fetchImpl.mock.calls[4]![1].body as string);
    // No source_url → fall back to the row's image_url.
    expect(postBody.content).toContain("https://cdn.example.com/original.png");
    expect(postBody.content).toContain("wp-image-778");
  });

  it("uses an SEO-friendly Content-Disposition filename derived from alt → section heading → article context", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      title: "Modern smart home guide",
      target_keyword: "smart home",
      content_markdown: SECTION_BODY,
    };
    const { client } = makeClient({
      articleReads: [article],
      sectionImageRows: [
        makeSectionRow({
          wp_media_id: null,
          alt_text: "Front porch doorbell",
        }),
      ],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/jpeg" }))
      .mockResolvedValueOnce(makeMediaUploadResponse({ id: 1 }))
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const uploadHeaders = fetchImpl.mock.calls[1]![1].headers as Record<
      string,
      string
    >;
    expect(uploadHeaders["Content-Disposition"]).toBe(
      'attachment; filename="front-porch-doorbell.jpg"',
    );
  });

  it("falls back to the section heading in the filename when alt_text is missing", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      title: "Modern smart home guide",
      target_keyword: "smart home",
      content_markdown: SECTION_BODY,
    };
    const { client } = makeClient({
      articleReads: [article],
      sectionImageRows: [
        makeSectionRow({
          wp_media_id: null,
          alt_text: null, // null alt → uploader skips the alt-text PUT
          section_heading: "Top picks under $200",
        }),
      ],
    });
    const fetchImpl = vi
      .fn()
      // 1: image fetch
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      // 2: WP media POST
      .mockResolvedValueOnce(makeMediaUploadResponse({ id: 1 }))
      // NOTE: no alt-text PUT (alt_text is null)
      // 3: Unsplash tracker
      .mockResolvedValueOnce({ ok: true, status: 200 })
      // 4: WP posts POST
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const uploadHeaders = fetchImpl.mock.calls[1]![1].headers as Record<
      string,
      string
    >;
    expect(uploadHeaders["Content-Disposition"]).toBe(
      'attachment; filename="top-picks-under-200.png"',
    );
  });

  // -------------------------------------------------------------------------
  // Multi-section + ordering
  // -------------------------------------------------------------------------

  it("uploads multiple section images and injects each before its matching H2", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      content_markdown: SECTION_BODY,
    };
    const { client } = makeClient({
      articleReads: [article],
      sectionImageRows: [
        makeSectionRow({
          id: "row-intro",
          section_key: "intro",
          image_url: "https://cdn.example.com/intro.png",
          wp_media_id: null,
        }),
        makeSectionRow({
          id: "row-faq",
          section_key: "faq",
          section_heading: "FAQ",
          sort_order: 1,
          image_url: "https://cdn.example.com/faq.png",
          wp_media_id: null,
        }),
      ],
    });
    const fetchImpl = vi
      .fn()
      // intro image fetch
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      // intro WP media POST
      .mockResolvedValueOnce(
        makeMediaUploadResponse({
          id: 101,
          source_url: "https://example.com/uploads/intro.png",
        }),
      )
      // intro alt PUT
      .mockResolvedValueOnce({ ok: true, status: 200 })
      // intro tracker
      .mockResolvedValueOnce({ ok: true, status: 200 })
      // faq image fetch
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      // faq WP media POST
      .mockResolvedValueOnce(
        makeMediaUploadResponse({
          id: 102,
          source_url: "https://example.com/uploads/faq.png",
        }),
      )
      // faq alt PUT
      .mockResolvedValueOnce({ ok: true, status: 200 })
      // faq tracker
      .mockResolvedValueOnce({ ok: true, status: 200 })
      // WP posts POST
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const postBody = JSON.parse(fetchImpl.mock.calls.at(-1)![1].body as string);
    // Both figures appear, intro before faq, each before its H2.
    const introIdx = postBody.content.indexOf("intro.png");
    const faqIdx = postBody.content.indexOf("faq.png");
    const introH2Idx = postBody.content.indexOf("<h2>Intro</h2>");
    const faqH2Idx = postBody.content.indexOf("<h2>FAQ</h2>");
    expect(introIdx).toBeGreaterThan(-1);
    expect(faqIdx).toBeGreaterThan(-1);
    expect(introIdx).toBeLessThan(introH2Idx);
    expect(faqIdx).toBeLessThan(faqH2Idx);
    expect(introIdx).toBeLessThan(faqIdx);
  });

  it("silently ignores orphan rows whose section_key is no longer in the saved body", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      // Body only contains Intro now — `## FAQ` was removed.
      content_markdown: "## Intro\n\nIntro body.\n",
    };
    const { client } = makeClient({
      articleReads: [article],
      sectionImageRows: [
        makeSectionRow({ section_key: "intro", wp_media_id: 200 }),
        // Orphan — its H2 was deleted from the body. MUST NOT upload.
        makeSectionRow({
          id: "row-orphan",
          section_key: "ghost",
          section_heading: "Ghost",
          image_url: "https://cdn.example.com/ghost.png",
          wp_media_id: null,
        }),
      ],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    // Only the post call — no upload for the orphan, even though
    // its wp_media_id is null.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const postBody = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    // Intro figure renders (cached id).
    expect(postBody.content).toContain("wp-image-200");
    // Ghost image URL doesn't appear anywhere.
    expect(postBody.content).not.toContain("ghost.png");
  });

  it("handles duplicate H2 keys (faq, faq-2) via the parser's deduped keys", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      content_markdown: "## FAQ\n\nFirst.\n\n## FAQ\n\nSecond.\n",
    };
    const { client } = makeClient({
      articleReads: [article],
      sectionImageRows: [
        makeSectionRow({
          id: "row-faq-1",
          section_key: "faq",
          image_url: "https://cdn.example.com/faq-1.png",
          wp_media_id: 301,
        }),
        makeSectionRow({
          id: "row-faq-2",
          section_key: "faq-2",
          image_url: "https://cdn.example.com/faq-2.png",
          wp_media_id: 302,
        }),
      ],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const postBody = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    const idx1 = postBody.content.indexOf("faq-1.png");
    const idx2 = postBody.content.indexOf("faq-2.png");
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(-1);
    expect(idx1).toBeLessThan(idx2);
  });

  // -------------------------------------------------------------------------
  // Attribution rendering
  // -------------------------------------------------------------------------

  it("renders Unsplash attribution figcaption with safe-escaped name + nofollow links", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      content_markdown: "## Intro\n\nBody.\n",
    };
    const { client } = makeClient({
      articleReads: [article],
      sectionImageRows: [
        makeSectionRow({
          section_key: "intro",
          wp_media_id: 555,
          photographer_name: "Annie & Co",
          photographer_profile_url: "https://unsplash.com/@anniespratt",
          photo_url: "https://unsplash.com/photos/abc",
        }),
      ],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const postBody = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(postBody.content).toContain("<figcaption>");
    expect(postBody.content).toContain("rel=\"nofollow noopener noreferrer\"");
    // & in name is HTML-entity-escaped.
    expect(postBody.content).toMatch(/Annie &(amp|#x26|#38); Co/);
  });

  // -------------------------------------------------------------------------
  // All publish modes
  // -------------------------------------------------------------------------

  it("updateArticleWordPressDraft also includes section images in the PUT payload", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      content_markdown: SECTION_BODY,
      wp_post_id: 7,
    };
    const { client } = makeClient({
      articleReads: [article],
      sectionImageRows: [
        makeSectionRow({ section_key: "intro", wp_media_id: 200 }),
      ],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await updateArticleWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const opts = fetchImpl.mock.calls[0]![1];
    expect(opts.method).toBe("PUT");
    const postBody = JSON.parse(opts.body as string);
    expect(postBody.status).toBe("draft");
    expect(postBody.content).toContain("wp-image-200");
  });

  it("publishArticleToWordPressLive also includes section images in the PUT payload", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      content_markdown: SECTION_BODY,
      wp_post_id: 7,
    };
    const { client } = makeClient({
      // Two reads: loadArticleForPublish + the published_at probe in
      // the publish_live path.
      articleReads: [article, { published_at: null }],
      sectionImageRows: [
        makeSectionRow({ section_key: "intro", wp_media_id: 200 }),
      ],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressLive({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    const postBody = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(postBody.status).toBe("publish");
    expect(postBody.content).toContain("wp-image-200");
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it("re-throws section_image_fetch_failed when the source image URL is unreachable", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      content_markdown: SECTION_BODY,
    };
    const { client } = makeClient({
      articleReads: [article],
      sectionImageRows: [makeSectionRow({ wp_media_id: null })],
    });
    const fetchImpl = vi
      .fn()
      // image fetch rejects
      .mockRejectedValueOnce(new Error("ENOTFOUND"));

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      name: "PublishArticleError",
      code: "section_image_fetch_failed",
    });

    // No /posts call — publish aborted before the article POST.
    const postCalls = fetchImpl.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("/posts"),
    );
    expect(postCalls).toHaveLength(0);
  });

  it("re-throws section_image_invalid_content_type when source URL returns a non-image", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      content_markdown: SECTION_BODY,
    };
    const { client } = makeClient({
      articleReads: [article],
      sectionImageRows: [makeSectionRow({ wp_media_id: null })],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "text/html" }));

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "section_image_invalid_content_type",
    });
  });

  it("re-throws section_image_upload_failed when the WP media POST is rejected", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      content_markdown: SECTION_BODY,
    };
    const { client } = makeClient({
      articleReads: [article],
      sectionImageRows: [makeSectionRow({ wp_media_id: null })],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: vi.fn().mockResolvedValue("media upload not permitted"),
      });

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "section_image_upload_failed",
    });
  });

  it("re-throws section_image_invalid_response when the WP media POST returns malformed JSON", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      content_markdown: SECTION_BODY,
    };
    const { client } = makeClient({
      articleReads: [article],
      sectionImageRows: [makeSectionRow({ wp_media_id: null })],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: "Created",
        // No `id` field — triggers the wp_invalid_media_response in
        // the inner uploader, re-wrapped to section_image_invalid_response.
        json: vi.fn().mockResolvedValue({ not_an_id: true }),
        text: vi.fn().mockResolvedValue(""),
      });

    await expect(
      publishArticleToWordPressDraft({
        articleId: "a1",
        blogId: "b1",
        client,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "section_image_invalid_response",
    });
  });

  // -------------------------------------------------------------------------
  // Featured image still works
  // -------------------------------------------------------------------------

  it("preserves featured image upload behavior when both featured + section images are present", async () => {
    const article: ArticleRow = {
      ...defaultArticle,
      content_markdown: SECTION_BODY,
      featured_image_url: "https://cdn.example.com/featured.png",
      featured_image_alt: "Featured hero",
      wp_featured_media_id: null,
    };
    const { client, recordedUpdates } = makeClient({
      articleReads: [article],
      sectionImageRows: [makeSectionRow({ wp_media_id: 999 })],
    });
    const fetchImpl = vi
      .fn()
      // featured image fetch + upload + alt PUT
      .mockResolvedValueOnce(makeImageResponse({ contentType: "image/png" }))
      .mockResolvedValueOnce(makeMediaUploadResponse({ id: 50 }))
      .mockResolvedValueOnce({ ok: true, status: 200 })
      // WP posts POST (no section upload because section row is cached)
      .mockResolvedValueOnce(
        makeOkResponse({ id: 7, link: "https://example.com/?p=7" }),
      );

    await publishArticleToWordPressDraft({
      articleId: "a1",
      blogId: "b1",
      client,
      fetchImpl: fetchImpl as never,
    });

    // Featured upload happened — cached on article row.
    const featuredCache = recordedUpdates.find(
      (u) => "wp_featured_media_id" in u,
    );
    expect(featuredCache).toEqual({ wp_featured_media_id: 50 });

    // Post payload carries the featured_media id.
    const postBody = JSON.parse(fetchImpl.mock.calls[3]![1].body as string);
    expect(postBody.featured_media).toBe(50);
    // And the section image figure with the cached wp-image-999 class.
    expect(postBody.content).toContain("wp-image-999");
  });
});
