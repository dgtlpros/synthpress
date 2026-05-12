import { beforeEach, describe, expect, it, vi } from "vitest";

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
  buildWordPressPostsEndpoint,
  clearWordPressLink,
  PublishArticleError,
  publishArticleToWordPressDraft,
  publishArticleToWordPressLive,
  updateArticleWordPressDraft,
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
  wp_post_id: number | null;
}

interface BlogConnRow {
  wp_url: string | null;
  wp_username: string | null;
  wp_app_password: string | null;
}

interface PublishedAtRow {
  published_at: string | null;
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
}

interface MockClient {
  client: never;
  recordedUpdates: Array<Record<string, unknown>>;
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

  const client = {
    from: vi.fn((table: string) => {
      if (table === "articles") return makeArticleChain();
      if (table === "blogs") return blogChain;
      throw new Error(`unexpected table: ${table}`);
    }),
  };

  return {
    client: client as never,
    recordedUpdates,
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
  wp_post_id: null,
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

    expect(mockedMarkdownToHtml).toHaveBeenCalledWith("Edited body.");
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
