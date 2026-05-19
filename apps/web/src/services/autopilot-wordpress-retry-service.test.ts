import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("./wordpress-publish-service", async () => {
  const actual = await vi.importActual<
    typeof import("./wordpress-publish-service")
  >("./wordpress-publish-service");
  return {
    ...actual,
    hasBlogWordPressConnection: vi.fn(),
    publishArticleToWordPressDraft: vi.fn(),
  };
});
vi.mock("./blog-autopilot-run-service", () => ({
  syncAutopilotRunWordPressDraftCounters: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  hasBlogWordPressConnection,
  PublishArticleError,
  publishArticleToWordPressDraft,
} from "./wordpress-publish-service";
import { syncAutopilotRunWordPressDraftCounters } from "./blog-autopilot-run-service";
import {
  RETRY_ERROR_COPY,
  RetryAutopilotWpDraftError,
  retryAutopilotJobWordPressDraft,
} from "./autopilot-wordpress-retry-service";

const mockedCreateAdmin = vi.mocked(createAdminClient);
const mockedHasConnection = vi.mocked(hasBlogWordPressConnection);
const mockedPublishDraft = vi.mocked(publishArticleToWordPressDraft);
const mockedSyncCounters = vi.mocked(syncAutopilotRunWordPressDraftCounters);

// ---- Mock Supabase chain helpers ----------------------------------------
//
// Two terminal patterns in the service:
//   * `.from("article_jobs").select(...).eq(...).maybeSingle()` (job load)
//   * `.from("articles").select(...).eq(...).eq(...).maybeSingle()` (article load)
//   * `.from("article_jobs").select("output").eq(...).maybeSingle()` (merge read)
//   * `.from("article_jobs").update(...).eq(...)` (merge write — awaited
//     directly, no .single — so the chain itself is thenable).
//
// `makeClient` below stamps a `then` on every per-table chain so
// `await` works for the update path.

interface ChainResult<T> {
  data: T;
  error: { message?: string } | null;
}

function makeChain<T>(seq: Array<ChainResult<T>>) {
  // For chains that terminate at `.maybeSingle()`, each call to
  // `.maybeSingle()` returns the next entry in `seq` so a single
  // table can serve multiple reads in one test (e.g. the merge
  // re-read after the initial validation read).
  let i = 0;
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    update: vi.fn(() => chain),
    maybeSingle: vi.fn(() => {
      const next = seq[Math.min(i, seq.length - 1)];
      i += 1;
      return Promise.resolve(next);
    }),
  };
  // Awaitable for the .update().eq() terminal.
  (chain as unknown as PromiseLike<ChainResult<T>>).then = ((
    onFulfilled: ((v: ChainResult<T>) => unknown) | null | undefined,
    onRejected: ((r: unknown) => unknown) | null | undefined,
  ) =>
    Promise.resolve(seq[seq.length - 1]).then(
      onFulfilled,
      onRejected,
    )) as never;
  return chain;
}

interface MockClient {
  from: ReturnType<typeof vi.fn>;
  __chains: {
    article_jobs?: ReturnType<typeof makeChain>;
    articles?: ReturnType<typeof makeChain>;
  };
}

function makeClient(opts: {
  jobReads?: Array<ChainResult<unknown>>;
  articleRead?: ChainResult<unknown>;
  jobUpdate?: ChainResult<unknown>;
}): MockClient {
  // Two separate chains because tests inspect them independently.
  // The article_jobs chain has to satisfy: initial-load read,
  // merge-read, and merge-write. We pass the sequence directly.
  const articleJobsChain = makeChain(
    opts.jobReads ?? [{ data: null, error: null }],
  );
  const articlesChain = makeChain([
    opts.articleRead ?? { data: null, error: null },
  ]);
  // Stamp the update terminal on the article_jobs chain.
  (articleJobsChain as unknown as PromiseLike<ChainResult<unknown>>).then = ((
    onFulfilled: ((v: ChainResult<unknown>) => unknown) | null | undefined,
    onRejected: ((r: unknown) => unknown) | null | undefined,
  ) =>
    Promise.resolve(opts.jobUpdate ?? { data: null, error: null }).then(
      onFulfilled,
      onRejected,
    )) as never;
  const chains: MockClient["__chains"] = {
    article_jobs: articleJobsChain,
    articles: articlesChain,
  };
  const client: MockClient = {
    from: vi.fn((table: string) => {
      if (table === "article_jobs") return articleJobsChain;
      if (table === "articles") return articlesChain;
      throw new Error(`unexpected table: ${table}`);
    }),
    __chains: chains,
  };
  return client;
}

// Shared fixtures
const RUN_ID = "run-1";
const BLOG_ID = "blog-1";
const JOB_ID = "job-1";
const ARTICLE_ID = "article-1";

function baseJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    blog_id: BLOG_ID,
    article_id: ARTICLE_ID,
    input: { autopilotRunId: RUN_ID },
    output: { wpPublish: { status: "failed", warning: "old failure" } },
    ...overrides,
  };
}

function baseArticleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ARTICLE_ID,
    content_markdown: "# Hello world\n\nBody.",
    wp_post_id: null,
    wp_post_url: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedHasConnection.mockResolvedValue(true);
  mockedPublishDraft.mockResolvedValue({
    wpPostId: 42,
    wpPostUrl: "https://example.com/?p=42",
    status: "draft",
  });
  mockedSyncCounters.mockResolvedValue({
    expected: 0,
    created: 0,
    alreadySent: 0,
    skipped: 0,
    failed: 0,
  });
});

// ============================================================================
// Error copy
// ============================================================================

describe("RETRY_ERROR_COPY", () => {
  it("covers every RetryAutopilotWpDraftErrorCode", () => {
    // Sanity: every code in the enum has a non-empty UI string.
    const codes: Array<keyof typeof RETRY_ERROR_COPY> = [
      "job_not_found",
      "job_blog_mismatch",
      "job_run_mismatch",
      "job_missing_article_id",
      "job_not_retryable",
      "article_not_found",
      "article_missing_content",
      "no_wp_connection",
    ];
    for (const code of codes) {
      expect(typeof RETRY_ERROR_COPY[code]).toBe("string");
      expect(RETRY_ERROR_COPY[code].length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// retryAutopilotJobWordPressDraft — validation guards
// ============================================================================

describe("retryAutopilotJobWordPressDraft — validation", () => {
  it("throws job_not_found when no row matches", async () => {
    const client = makeClient({ jobReads: [{ data: null, error: null }] });
    await expect(
      retryAutopilotJobWordPressDraft({
        runId: RUN_ID,
        blogId: BLOG_ID,
        jobId: JOB_ID,
        client: client as never,
      }),
    ).rejects.toMatchObject({ code: "job_not_found" });
    // No publish attempt.
    expect(mockedPublishDraft).not.toHaveBeenCalled();
    expect(mockedSyncCounters).not.toHaveBeenCalled();
  });

  it("throws job_blog_mismatch when the job belongs to a different blog", async () => {
    const client = makeClient({
      jobReads: [{ data: baseJobRow({ blog_id: "other-blog" }), error: null }],
    });
    await expect(
      retryAutopilotJobWordPressDraft({
        runId: RUN_ID,
        blogId: BLOG_ID,
        jobId: JOB_ID,
        client: client as never,
      }),
    ).rejects.toMatchObject({ code: "job_blog_mismatch" });
  });

  it("throws job_run_mismatch when input.autopilotRunId points elsewhere", async () => {
    const client = makeClient({
      jobReads: [
        {
          data: baseJobRow({ input: { autopilotRunId: "other-run" } }),
          error: null,
        },
      ],
    });
    await expect(
      retryAutopilotJobWordPressDraft({
        runId: RUN_ID,
        blogId: BLOG_ID,
        jobId: JOB_ID,
        client: client as never,
      }),
    ).rejects.toMatchObject({ code: "job_run_mismatch" });
  });

  it("throws job_run_mismatch when input.autopilotRunId is missing entirely (manual job)", async () => {
    const client = makeClient({
      jobReads: [{ data: baseJobRow({ input: {} }), error: null }],
    });
    await expect(
      retryAutopilotJobWordPressDraft({
        runId: RUN_ID,
        blogId: BLOG_ID,
        jobId: JOB_ID,
        client: client as never,
      }),
    ).rejects.toMatchObject({ code: "job_run_mismatch" });
  });

  it("throws job_run_mismatch when input is null / non-object / array", async () => {
    // null
    {
      const client = makeClient({
        jobReads: [{ data: baseJobRow({ input: null }), error: null }],
      });
      await expect(
        retryAutopilotJobWordPressDraft({
          runId: RUN_ID,
          blogId: BLOG_ID,
          jobId: JOB_ID,
          client: client as never,
        }),
      ).rejects.toMatchObject({ code: "job_run_mismatch" });
    }
    // array
    {
      const client = makeClient({
        jobReads: [{ data: baseJobRow({ input: [1, 2, 3] }), error: null }],
      });
      await expect(
        retryAutopilotJobWordPressDraft({
          runId: RUN_ID,
          blogId: BLOG_ID,
          jobId: JOB_ID,
          client: client as never,
        }),
      ).rejects.toMatchObject({ code: "job_run_mismatch" });
    }
    // non-string autopilotRunId
    {
      const client = makeClient({
        jobReads: [
          {
            data: baseJobRow({ input: { autopilotRunId: 42 } }),
            error: null,
          },
        ],
      });
      await expect(
        retryAutopilotJobWordPressDraft({
          runId: RUN_ID,
          blogId: BLOG_ID,
          jobId: JOB_ID,
          client: client as never,
        }),
      ).rejects.toMatchObject({ code: "job_run_mismatch" });
    }
    // empty-string autopilotRunId
    {
      const client = makeClient({
        jobReads: [
          {
            data: baseJobRow({ input: { autopilotRunId: "" } }),
            error: null,
          },
        ],
      });
      await expect(
        retryAutopilotJobWordPressDraft({
          runId: RUN_ID,
          blogId: BLOG_ID,
          jobId: JOB_ID,
          client: client as never,
        }),
      ).rejects.toMatchObject({ code: "job_run_mismatch" });
    }
  });

  it("throws job_missing_article_id when article_id is null", async () => {
    const client = makeClient({
      jobReads: [{ data: baseJobRow({ article_id: null }), error: null }],
    });
    await expect(
      retryAutopilotJobWordPressDraft({
        runId: RUN_ID,
        blogId: BLOG_ID,
        jobId: JOB_ID,
        client: client as never,
      }),
    ).rejects.toMatchObject({ code: "job_missing_article_id" });
  });

  it("throws job_not_retryable when the job has no wpPublish key", async () => {
    const client = makeClient({
      jobReads: [
        {
          data: baseJobRow({ output: { imageSummary: { warnings: [] } } }),
          error: null,
        },
      ],
    });
    await expect(
      retryAutopilotJobWordPressDraft({
        runId: RUN_ID,
        blogId: BLOG_ID,
        jobId: JOB_ID,
        client: client as never,
      }),
    ).rejects.toMatchObject({ code: "job_not_retryable" });
  });

  it("throws job_not_retryable when wpPublish.status is draft_created or already_sent", async () => {
    for (const status of ["draft_created", "already_sent"]) {
      const client = makeClient({
        jobReads: [
          {
            data: baseJobRow({ output: { wpPublish: { status } } }),
            error: null,
          },
        ],
      });
      await expect(
        retryAutopilotJobWordPressDraft({
          runId: RUN_ID,
          blogId: BLOG_ID,
          jobId: JOB_ID,
          client: client as never,
        }),
      ).rejects.toMatchObject({ code: "job_not_retryable" });
    }
  });

  it("throws job_not_retryable when output is null / non-object / wpPublish is malformed", async () => {
    // output = null
    {
      const client = makeClient({
        jobReads: [{ data: baseJobRow({ output: null }), error: null }],
      });
      await expect(
        retryAutopilotJobWordPressDraft({
          runId: RUN_ID,
          blogId: BLOG_ID,
          jobId: JOB_ID,
          client: client as never,
        }),
      ).rejects.toMatchObject({ code: "job_not_retryable" });
    }
    // output is an array
    {
      const client = makeClient({
        jobReads: [{ data: baseJobRow({ output: [1] }), error: null }],
      });
      await expect(
        retryAutopilotJobWordPressDraft({
          runId: RUN_ID,
          blogId: BLOG_ID,
          jobId: JOB_ID,
          client: client as never,
        }),
      ).rejects.toMatchObject({ code: "job_not_retryable" });
    }
    // wpPublish is null / array / non-string status
    for (const wp of [null, [1], { status: 42 }]) {
      const client = makeClient({
        jobReads: [
          {
            data: baseJobRow({ output: { wpPublish: wp } }),
            error: null,
          },
        ],
      });
      await expect(
        retryAutopilotJobWordPressDraft({
          runId: RUN_ID,
          blogId: BLOG_ID,
          jobId: JOB_ID,
          client: client as never,
        }),
      ).rejects.toMatchObject({ code: "job_not_retryable" });
    }
  });

  it("propagates a Supabase error from the job load", async () => {
    const client = makeClient({
      jobReads: [{ data: null, error: { message: "boom" } }],
    });
    await expect(
      retryAutopilotJobWordPressDraft({
        runId: RUN_ID,
        blogId: BLOG_ID,
        jobId: JOB_ID,
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "boom" });
  });

  it("throws article_not_found when the article row is missing", async () => {
    const client = makeClient({
      jobReads: [{ data: baseJobRow(), error: null }],
      articleRead: { data: null, error: null },
    });
    await expect(
      retryAutopilotJobWordPressDraft({
        runId: RUN_ID,
        blogId: BLOG_ID,
        jobId: JOB_ID,
        client: client as never,
      }),
    ).rejects.toMatchObject({ code: "article_not_found" });
  });

  it("propagates a Supabase error from the article load", async () => {
    const client = makeClient({
      jobReads: [{ data: baseJobRow(), error: null }],
      articleRead: { data: null, error: { message: "article query broke" } },
    });
    await expect(
      retryAutopilotJobWordPressDraft({
        runId: RUN_ID,
        blogId: BLOG_ID,
        jobId: JOB_ID,
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "article query broke" });
  });

  it("throws article_missing_content when content_markdown is empty / whitespace / null", async () => {
    for (const md of [null, "", "   \n  "]) {
      const client = makeClient({
        jobReads: [{ data: baseJobRow(), error: null }],
        articleRead: {
          data: baseArticleRow({ content_markdown: md }),
          error: null,
        },
      });
      await expect(
        retryAutopilotJobWordPressDraft({
          runId: RUN_ID,
          blogId: BLOG_ID,
          jobId: JOB_ID,
          client: client as never,
        }),
      ).rejects.toMatchObject({ code: "article_missing_content" });
    }
  });

  it("throws no_wp_connection when the blog has no WordPress credentials", async () => {
    mockedHasConnection.mockResolvedValueOnce(false);
    const client = makeClient({
      jobReads: [{ data: baseJobRow(), error: null }],
      articleRead: { data: baseArticleRow(), error: null },
    });
    await expect(
      retryAutopilotJobWordPressDraft({
        runId: RUN_ID,
        blogId: BLOG_ID,
        jobId: JOB_ID,
        client: client as never,
      }),
    ).rejects.toMatchObject({ code: "no_wp_connection" });
    expect(mockedPublishDraft).not.toHaveBeenCalled();
  });
});

// ============================================================================
// retryAutopilotJobWordPressDraft — success / idempotency / failure paths
// ============================================================================

describe("retryAutopilotJobWordPressDraft — outcomes", () => {
  it("publishes a new draft and writes wpPublish=draft_created on success", async () => {
    const client = makeClient({
      // job loaded twice: validation read + merge-read for output.
      jobReads: [
        { data: baseJobRow(), error: null },
        {
          data: {
            output: {
              wpPublish: { status: "failed", warning: "old failure" },
              creditsUsed: 5,
              imageSummary: { warnings: [] },
            },
          },
          error: null,
        },
      ],
      articleRead: { data: baseArticleRow(), error: null },
      jobUpdate: { data: null, error: null },
    });

    const out = await retryAutopilotJobWordPressDraft({
      runId: RUN_ID,
      blogId: BLOG_ID,
      jobId: JOB_ID,
      client: client as never,
    });

    expect(out.wpPublish).toEqual({
      attempted: true,
      status: "draft_created",
      wpPostId: 42,
      wpPostUrl: "https://example.com/?p=42",
    });

    expect(mockedPublishDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        articleId: ARTICLE_ID,
        blogId: BLOG_ID,
        client,
      }),
    );

    // Merge update preserved siblings + replaced wpPublish.
    expect(client.__chains.article_jobs!.update).toHaveBeenCalledWith({
      output: {
        wpPublish: {
          attempted: true,
          status: "draft_created",
          wpPostId: 42,
          wpPostUrl: "https://example.com/?p=42",
        },
        creditsUsed: 5,
        imageSummary: { warnings: [] },
      },
    });

    // Counters re-synced.
    expect(mockedSyncCounters).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: RUN_ID,
        blogId: BLOG_ID,
        client,
      }),
    );
  });

  it("short-circuits to already_sent (no publish call) when article.wp_post_id is already set", async () => {
    const client = makeClient({
      jobReads: [
        { data: baseJobRow(), error: null },
        { data: { output: {} }, error: null }, // merge read — empty output
      ],
      articleRead: {
        data: baseArticleRow({
          wp_post_id: 99,
          wp_post_url: "https://example.com/?p=99",
        }),
        error: null,
      },
      jobUpdate: { data: null, error: null },
    });

    const out = await retryAutopilotJobWordPressDraft({
      runId: RUN_ID,
      blogId: BLOG_ID,
      jobId: JOB_ID,
      client: client as never,
    });

    expect(out.wpPublish).toEqual({
      attempted: false,
      status: "already_sent",
      wpPostId: 99,
      wpPostUrl: "https://example.com/?p=99",
    });
    expect(mockedPublishDraft).not.toHaveBeenCalled();
    expect(mockedSyncCounters).toHaveBeenCalledOnce();
  });

  it("treats wp_post_url=null on the article row as wpPostUrl=null in the already_sent result", async () => {
    const client = makeClient({
      jobReads: [
        { data: baseJobRow(), error: null },
        { data: { output: {} }, error: null },
      ],
      articleRead: {
        data: baseArticleRow({
          wp_post_id: 17,
          wp_post_url: null,
        }),
        error: null,
      },
    });

    const out = await retryAutopilotJobWordPressDraft({
      runId: RUN_ID,
      blogId: BLOG_ID,
      jobId: JOB_ID,
      client: client as never,
    });

    expect(out.wpPublish).toMatchObject({
      status: "already_sent",
      wpPostId: 17,
      wpPostUrl: null,
    });
  });

  it("captures a PublishArticleError as wpPublish=failed with friendly copy + still merges/syncs", async () => {
    mockedPublishDraft.mockRejectedValueOnce(
      new PublishArticleError("wp_request_failed"),
    );
    const client = makeClient({
      jobReads: [
        { data: baseJobRow(), error: null },
        { data: { output: { creditsUsed: 7 } }, error: null },
      ],
      articleRead: { data: baseArticleRow(), error: null },
    });

    const out = await retryAutopilotJobWordPressDraft({
      runId: RUN_ID,
      blogId: BLOG_ID,
      jobId: JOB_ID,
      client: client as never,
    });

    expect(out.wpPublish).toMatchObject({
      attempted: true,
      status: "failed",
    });
    expect(
      out.wpPublish.status === "failed" && out.wpPublish.warning,
    ).toBeTruthy();

    expect(client.__chains.article_jobs!.update).toHaveBeenCalledWith({
      output: expect.objectContaining({
        creditsUsed: 7,
        wpPublish: expect.objectContaining({ status: "failed" }),
      }),
    });
    expect(mockedSyncCounters).toHaveBeenCalledOnce();
  });

  it("captures a generic Error (non-PublishArticleError) as wpPublish=failed with the underlying message", async () => {
    // Defensive path — covers the `instanceof PublishArticleError`
    // false branch. In practice the publish helper always wraps
    // failures as PublishArticleError, but a future regression
    // (or middleware) could leak a raw Error through.
    mockedPublishDraft.mockRejectedValueOnce(new Error("socket hung up"));
    const client = makeClient({
      jobReads: [
        { data: baseJobRow(), error: null },
        { data: { output: {} }, error: null },
      ],
      articleRead: { data: baseArticleRow(), error: null },
    });

    const out = await retryAutopilotJobWordPressDraft({
      runId: RUN_ID,
      blogId: BLOG_ID,
      jobId: JOB_ID,
      client: client as never,
    });

    expect(out.wpPublish).toEqual({
      attempted: true,
      status: "failed",
      // `String(new Error("socket hung up"))` returns "Error: socket hung up".
      // We surface this verbatim — this branch is defensive only
      // (the publish helper normally throws PublishArticleError).
      warning: "Error: socket hung up",
    });
    expect(mockedSyncCounters).toHaveBeenCalledOnce();
  });

  it("retries a previously skipped_no_connection job once WordPress is reconnected", async () => {
    const client = makeClient({
      jobReads: [
        {
          data: baseJobRow({
            output: {
              wpPublish: {
                attempted: false,
                status: "skipped_no_connection",
                warning: "no connection",
              },
            },
          }),
          error: null,
        },
        { data: { output: {} }, error: null },
      ],
      articleRead: { data: baseArticleRow(), error: null },
    });

    const out = await retryAutopilotJobWordPressDraft({
      runId: RUN_ID,
      blogId: BLOG_ID,
      jobId: JOB_ID,
      client: client as never,
    });

    expect(out.wpPublish.status).toBe("draft_created");
    expect(mockedPublishDraft).toHaveBeenCalledOnce();
  });

  it("merges over an empty (defensive) output without losing the wpPublish key", async () => {
    const client = makeClient({
      jobReads: [
        { data: baseJobRow(), error: null },
        { data: { output: null }, error: null }, // covers the `??= {}` branch
      ],
      articleRead: { data: baseArticleRow(), error: null },
    });

    await retryAutopilotJobWordPressDraft({
      runId: RUN_ID,
      blogId: BLOG_ID,
      jobId: JOB_ID,
      client: client as never,
    });

    expect(client.__chains.article_jobs!.update).toHaveBeenCalledWith({
      output: {
        wpPublish: expect.objectContaining({ status: "draft_created" }),
      },
    });
  });

  it("merges over an output that's an array (defensive) by replacing with a fresh object", async () => {
    const client = makeClient({
      jobReads: [
        { data: baseJobRow(), error: null },
        { data: { output: [1, 2, 3] }, error: null },
      ],
      articleRead: { data: baseArticleRow(), error: null },
    });

    await retryAutopilotJobWordPressDraft({
      runId: RUN_ID,
      blogId: BLOG_ID,
      jobId: JOB_ID,
      client: client as never,
    });

    expect(client.__chains.article_jobs!.update).toHaveBeenCalledWith({
      output: {
        wpPublish: expect.objectContaining({ status: "draft_created" }),
      },
    });
  });

  it("propagates a Supabase error from the merge-read", async () => {
    const client = makeClient({
      jobReads: [
        { data: baseJobRow(), error: null },
        { data: null, error: { message: "merge read broke" } },
      ],
      articleRead: { data: baseArticleRow(), error: null },
    });
    await expect(
      retryAutopilotJobWordPressDraft({
        runId: RUN_ID,
        blogId: BLOG_ID,
        jobId: JOB_ID,
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "merge read broke" });
    // Counter sync was never reached.
    expect(mockedSyncCounters).not.toHaveBeenCalled();
  });

  it("propagates a Supabase error from the merge-write", async () => {
    const client = makeClient({
      jobReads: [
        { data: baseJobRow(), error: null },
        { data: { output: {} }, error: null },
      ],
      articleRead: { data: baseArticleRow(), error: null },
      jobUpdate: { data: null, error: { message: "update broke" } },
    });
    await expect(
      retryAutopilotJobWordPressDraft({
        runId: RUN_ID,
        blogId: BLOG_ID,
        jobId: JOB_ID,
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "update broke" });
    expect(mockedSyncCounters).not.toHaveBeenCalled();
  });

  it("falls back to the admin client when none is supplied", async () => {
    const client = makeClient({
      jobReads: [
        { data: baseJobRow(), error: null },
        { data: { output: {} }, error: null },
      ],
      articleRead: { data: baseArticleRow(), error: null },
    });
    mockedCreateAdmin.mockReturnValueOnce(client as never);

    await retryAutopilotJobWordPressDraft({
      runId: RUN_ID,
      blogId: BLOG_ID,
      jobId: JOB_ID,
    });
    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Error class identity
// ============================================================================

describe("RetryAutopilotWpDraftError", () => {
  it("carries the code on .code and is identifiable via instanceof", () => {
    const err = new RetryAutopilotWpDraftError("article_not_found");
    expect(err).toBeInstanceOf(RetryAutopilotWpDraftError);
    expect(err.code).toBe("article_not_found");
    expect(err.name).toBe("RetryAutopilotWpDraftError");
    expect(err.message).toContain("article_not_found");
  });
});
