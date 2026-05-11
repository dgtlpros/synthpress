import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BLOG_SETTINGS } from "@/lib/blog-settings";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("workflow/api", () => ({
  start: vi.fn(),
}));

vi.mock("@/workflows/generate-article", () => ({
  generateArticleWorkflow: vi.fn(),
}));

vi.mock("./team-billing-service", () => ({
  getTeamPlan: vi.fn(),
}));

vi.mock("./article-generation-service", () => ({
  generateArticleIdeas: vi.fn(),
  queueGenerateArticleFromIdea: vi.fn(),
}));

vi.mock("./blog-autopilot-run-service", () => ({
  createBlogAutopilotRun: vi.fn(),
  updateBlogAutopilotRunStatus: vi.fn(),
  completeBlogAutopilotRun: vi.fn(),
  failBlogAutopilotRun: vi.fn(),
}));

import { start } from "workflow/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateArticleWorkflow } from "@/workflows/generate-article";
import { getTeamPlan } from "./team-billing-service";
import {
  generateArticleIdeas,
  queueGenerateArticleFromIdea,
} from "./article-generation-service";
import {
  completeBlogAutopilotRun,
  createBlogAutopilotRun,
  failBlogAutopilotRun,
  updateBlogAutopilotRunStatus,
} from "./blog-autopilot-run-service";
import {
  AUTOPAUSE_FAILURE_THRESHOLD,
  AUTOPAUSE_FAILURE_WINDOW_MINUTES,
  autoApproveIdeasForAutopilotRun,
  computeDailyMaxArticles,
  PAUSED_MESSAGE_FAILURE_RATE,
  PAUSED_REASON_FAILURE_RATE,
  PER_RUN_ARTICLE_CAP,
  pauseAutopilotForBlog,
  runAutopilotForBlog,
  runBlogAutopilotScheduler,
  shouldPauseAutopilotForFailures,
} from "./autopilot-scheduler-service";

const mockedCreateAdmin = vi.mocked(createAdminClient);
const mockedStart = vi.mocked(start);
const mockedGetTeamPlan = vi.mocked(getTeamPlan);
const mockedGenerateIdeas = vi.mocked(generateArticleIdeas);
const mockedQueueArticle = vi.mocked(queueGenerateArticleFromIdea);
const mockedCreateRun = vi.mocked(createBlogAutopilotRun);
const mockedUpdateRun = vi.mocked(updateBlogAutopilotRunStatus);
const mockedCompleteRun = vi.mocked(completeBlogAutopilotRun);
const mockedFailRun = vi.mocked(failBlogAutopilotRun);

// ---- Mock Supabase chain helpers ----------------------------------------

interface ChainResult<T> {
  data: T;
  error: { message: string } | null;
  count?: number | null;
}

function makeChain<T>(result: ChainResult<T>) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    then: ((onFulfilled, onRejected) =>
      Promise.resolve(result).then(
        onFulfilled,
        onRejected,
      )) as PromiseLike<ChainResult<T>>["then"],
  };
  return chain;
}

interface MockClient {
  from: ReturnType<typeof vi.fn>;
  __chains: Record<string, ReturnType<typeof makeChain>>;
}

function makeClient(table: Record<string, ChainResult<unknown>>): MockClient {
  const chains: Record<string, ReturnType<typeof makeChain>> = {};
  for (const [name, result] of Object.entries(table)) {
    chains[name] = makeChain(result);
  }
  const client = {
    from: vi.fn((name: string) => {
      if (!chains[name]) {
        chains[name] = makeChain({ data: null, error: null });
      }
      return chains[name];
    }),
    __chains: chains,
  };
  return client as unknown as MockClient;
}

// ---- Fixture helpers ----------------------------------------------------

function autopilotSettings(
  overrides: Partial<typeof DEFAULT_BLOG_SETTINGS.automation> = {},
) {
  return {
    ...DEFAULT_BLOG_SETTINGS,
    automation: {
      ...DEFAULT_BLOG_SETTINGS.automation,
      mode: "autopilot" as const,
      enabled: true,
      // Set explicit caps so each test controls the math:
      generatePerWeek: 14,
      maxPostsPerDay: 3,
      backlogThreshold: 5,
      dailyTokenBudget: null,
      ...overrides,
    },
  };
}

function manualSettings() {
  return {
    ...DEFAULT_BLOG_SETTINGS,
    automation: {
      ...DEFAULT_BLOG_SETTINGS.automation,
      mode: "manual" as const,
      enabled: false,
    },
  };
}

interface PerBlogClientOpts {
  /**
   * Pass `null` explicitly to simulate "blog row deleted between
   * eligibility scan and tick". Omit to get the default fixture.
   */
  blogRow?: {
    id: string;
    name: string;
    settings: ReturnType<typeof autopilotSettings>;
  } | null;
  approvedIdeas?: Array<{ id: string; title: string }>;
  todayArticleCount?: number;
  todayUsageEvents?: Array<{ credits_used: number | null }>;
}

const DEFAULT_BLOG_ROW = {
  id: "blog-1",
  name: "Indie Hacker Stories",
  settings: autopilotSettings(),
};

/**
 * Builds the mock Supabase client a single per-blog tick will
 * interact with: blogs.maybeSingle, article_ideas (.then), article_jobs
 * count (.then resolving with `count`), usage_events list (.then).
 */
function makePerBlogClient(opts: PerBlogClientOpts = {}): MockClient {
  // Distinguish "caller didn't pass blogRow" from "caller passed
  // null on purpose" — null means "simulate a missing blog".
  const blogRow =
    "blogRow" in opts ? opts.blogRow : DEFAULT_BLOG_ROW;
  const approvedIdeas = opts.approvedIdeas ?? [];
  const todayArticleCount = opts.todayArticleCount ?? 0;
  const todayUsageEvents = opts.todayUsageEvents ?? [];

  const client = makeClient({});
  client.__chains.blogs = makeChain({
    data: blogRow,
    error: null,
  });
  client.__chains.article_ideas = makeChain({
    data: approvedIdeas,
    error: null,
  });
  client.__chains.article_jobs = makeChain({
    data: null,
    error: null,
    count: todayArticleCount,
  });
  client.__chains.usage_events = makeChain({
    data: todayUsageEvents,
    error: null,
  });
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();

  // Sensible defaults — individual tests override with mockResolvedValueOnce.
  mockedCreateRun.mockResolvedValue({ id: "run-1" } as never);
  mockedUpdateRun.mockResolvedValue(undefined);
  mockedCompleteRun.mockResolvedValue(undefined);
  mockedFailRun.mockResolvedValue(undefined);
  mockedStart.mockResolvedValue({ id: "wf-run-1" } as never);
  mockedGetTeamPlan.mockResolvedValue({
    ownerId: "owner-1",
    planKey: "starter",
    status: "active",
    balance: 1000,
  } as never);
  mockedGenerateIdeas.mockResolvedValue({
    jobId: "job-ideas",
    ideas: [
      { id: "i-A", title: "A" } as never,
      { id: "i-B", title: "B" } as never,
    ],
    creditsUsed: 1,
    promptTokens: null,
    completionTokens: null,
    model: "claude",
  });
  mockedQueueArticle.mockResolvedValue({
    jobId: "job-1",
    articleId: "article-1",
    ideaId: "i-1",
    status: "pending",
    alreadyQueued: false,
  });
});

// ============================================================================
// computeDailyMaxArticles — pure helper
// ============================================================================

describe("computeDailyMaxArticles", () => {
  it("picks the smaller of maxPostsPerDay vs. ceil(generatePerWeek/7)", () => {
    expect(computeDailyMaxArticles(3, 14)).toBe(2); // ceil(14/7)=2 wins
    expect(computeDailyMaxArticles(1, 14)).toBe(1); // maxPostsPerDay=1 wins
    expect(computeDailyMaxArticles(10, 21)).toBe(3); // ceil(21/7)=3 wins
  });

  it("clamps both inputs to >= 0", () => {
    expect(computeDailyMaxArticles(-1, 14)).toBe(0);
    expect(computeDailyMaxArticles(3, -7)).toBe(0);
  });

  it("returns 0 when generatePerWeek is 0", () => {
    expect(computeDailyMaxArticles(5, 0)).toBe(0);
  });
});

// ============================================================================
// runAutopilotForBlog — eligibility / skip paths
// ============================================================================

describe("runAutopilotForBlog — eligibility", () => {
  it("creates the run + skips when the blog is missing", async () => {
    const client = makePerBlogClient({ blogRow: null });

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-missing",
      client: client as never,
    });

    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("blog_not_found");
    expect(mockedCreateRun).toHaveBeenCalled();
    expect(mockedCompleteRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        status: "skipped",
        output: { reason: "blog_not_found" },
      }),
    );
    expect(mockedQueueArticle).not.toHaveBeenCalled();
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it("skips when settings.automation.mode !== 'autopilot'", async () => {
    const client = makePerBlogClient({
      blogRow: { id: "b1", name: "Manual blog", settings: manualSettings() },
    });

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "b1",
      client: client as never,
    });

    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("autopilot_disabled");
    expect(mockedQueueArticle).not.toHaveBeenCalled();
  });

  it("skips when settings.automation.enabled === false (mode autopilot but disarmed)", async () => {
    const client = makePerBlogClient({
      blogRow: {
        id: "b1",
        name: "Disarmed",
        settings: autopilotSettings({ enabled: false }),
      },
    });

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "b1",
      client: client as never,
    });

    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("autopilot_disabled");
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makePerBlogClient({ blogRow: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
    });

    expect(mockedCreateAdmin).toHaveBeenCalled();
  });

  it("skips when the team has no billing context", async () => {
    const client = makePerBlogClient();
    mockedGetTeamPlan.mockResolvedValueOnce(null);

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("team_billing_unavailable");
  });
});

// ============================================================================
// runAutopilotForBlog — backlog top-up
// ============================================================================

describe("runAutopilotForBlog — backlog top-up", () => {
  it("generates ideas when approved backlog is below threshold (autopilotRunId stamped)", async () => {
    const client = makePerBlogClient({ approvedIdeas: [] }); // empty backlog

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(mockedGenerateIdeas).toHaveBeenCalledWith(
      expect.objectContaining({
        blogId: "blog-1",
        teamId: "t1",
        triggerSource: "autopilot",
        jobMetadata: { autopilotRunId: "run-1" },
      }),
    );
    expect(out.ideasGenerated).toBe(2);
    // No approved ideas → no article workflows. But generating ideas
    // IS productive work, so the run completes (the generated ideas
    // are awaiting human approval before they can become articles).
    expect(out.articleJobsStarted).toBe(0);
    expect(out.status).toBe("completed");
  });

  it("skips idea generation when approved backlog is at or above threshold", async () => {
    // backlogThreshold default in autopilotSettings() is 5; provide
    // exactly 5 approved ideas so the backlog top-up branch is NOT
    // entered.
    const ideas = Array.from({ length: 5 }, (_, i) => ({
      id: `i-${i}`,
      title: `Idea ${i}`,
    }));
    const client = makePerBlogClient({ approvedIdeas: ideas });

    await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(mockedGenerateIdeas).not.toHaveBeenCalled();
  });

  it("does NOT generate ideas in dry-run mode even if backlog is empty", async () => {
    const client = makePerBlogClient({ approvedIdeas: [] });

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      dryRun: true,
      client: client as never,
    });

    expect(mockedGenerateIdeas).not.toHaveBeenCalled();
    expect(mockedQueueArticle).not.toHaveBeenCalled();
    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("dry_run");
  });

  it("does NOT generate ideas when the team can't afford even an idea batch (records insufficient_balance)", async () => {
    const client = makePerBlogClient({ approvedIdeas: [] });
    mockedGetTeamPlan.mockResolvedValueOnce({
      ownerId: "owner-1",
      planKey: "starter",
      status: "active",
      balance: 0, // can't afford the 1-token idea batch
    } as never);

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(mockedGenerateIdeas).not.toHaveBeenCalled();
    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("insufficient_balance");
  });

  it("skips with 'no_approved_ideas_in_backlog' when backlog already meets threshold but has 0 approved ideas (e.g. threshold=0)", async () => {
    const client = makePerBlogClient({
      blogRow: {
        id: "blog-1",
        name: "Threshold-zero blog",
        // backlogThreshold=0 means "I never want autopilot to top up
        // ideas". With 0 approved ideas there's nothing to do.
        settings: autopilotSettings({ backlogThreshold: 0 }),
      },
      approvedIdeas: [],
    });

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(mockedGenerateIdeas).not.toHaveBeenCalled();
    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("no_approved_ideas_in_backlog");
  });

  it("does NOT generate ideas when the dailyTokenBudget can't afford an idea batch", async () => {
    const client = makePerBlogClient({
      blogRow: {
        id: "blog-1",
        name: "Tight budget",
        settings: autopilotSettings({ dailyTokenBudget: 0 }),
      },
      approvedIdeas: [],
    });

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(mockedGenerateIdeas).not.toHaveBeenCalled();
    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("backlog_empty_no_budget_for_ideas");
  });

  it("fails the run when generateArticleIdeas throws", async () => {
    const client = makePerBlogClient({ approvedIdeas: [] });
    mockedGenerateIdeas.mockRejectedValueOnce(new Error("Claude down"));

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.status).toBe("failed");
    expect(out.reason).toBe("idea_generation_failed");
    expect(mockedFailRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        errorMessage: expect.stringContaining("Claude down"),
        output: expect.objectContaining({ stage: "generating_ideas" }),
      }),
    );
  });
});

// ============================================================================
// runAutopilotForBlog — article workflow spawning
// ============================================================================

describe("runAutopilotForBlog — article workflow spawning", () => {
  it("queues + starts a workflow per approved idea (autopilotRunId in queue metadata + workflow input)", async () => {
    const ideas = [
      { id: "i-A", title: "Alpha" },
      { id: "i-B", title: "Beta" },
    ];
    const client = makePerBlogClient({
      blogRow: {
        id: "blog-1",
        name: "Plenty of budget",
        // backlog of 2 already meets threshold of 1 → no idea gen
        settings: autopilotSettings({ backlogThreshold: 1 }),
      },
      approvedIdeas: ideas,
    });
    mockedQueueArticle
      .mockResolvedValueOnce({
        jobId: "job-A",
        articleId: "art-A",
        ideaId: "i-A",
        status: "pending",
        alreadyQueued: false,
      })
      .mockResolvedValueOnce({
        jobId: "job-B",
        articleId: "art-B",
        ideaId: "i-B",
        status: "pending",
        alreadyQueued: false,
      });

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.status).toBe("completed");
    expect(out.articleJobsStarted).toBe(2);
    expect(out.articleJobIds).toEqual(["job-A", "job-B"]);
    expect(mockedGenerateIdeas).not.toHaveBeenCalled();

    expect(mockedQueueArticle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ideaId: "i-A",
        triggerSource: "autopilot",
        jobMetadata: { autopilotRunId: "run-1" },
      }),
    );
    expect(mockedStart).toHaveBeenNthCalledWith(
      1,
      generateArticleWorkflow,
      [
        expect.objectContaining({
          jobId: "job-A",
          articleId: "art-A",
          triggerSource: "autopilot",
          autopilotRunId: "run-1",
        }),
      ],
    );
    expect(mockedStart).toHaveBeenCalledTimes(2);
  });

  it("does NOT re-start the workflow when queueGenerateArticleFromIdea reports alreadyQueued (idempotency)", async () => {
    const client = makePerBlogClient({
      blogRow: {
        id: "blog-1",
        name: "x",
        settings: autopilotSettings({ backlogThreshold: 1 }),
      },
      approvedIdeas: [{ id: "i-A", title: "Alpha" }],
    });
    mockedQueueArticle.mockResolvedValueOnce({
      jobId: "job-existing",
      articleId: "art-existing",
      ideaId: "i-A",
      status: "processing",
      alreadyQueued: true,
    });

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(mockedStart).not.toHaveBeenCalled();
    expect(out.articleJobsStarted).toBe(0);
    // No new work + no failures → run is skipped, not completed.
    expect(out.status).toBe("skipped");
  });

  it("respects maxPostsPerDay (subtracts today's already-started count)", async () => {
    const ideas = Array.from({ length: 5 }, (_, i) => ({
      id: `i-${i}`,
      title: `Idea ${i}`,
    }));
    const client = makePerBlogClient({
      blogRow: {
        id: "blog-1",
        name: "x",
        settings: autopilotSettings({
          maxPostsPerDay: 3,
          generatePerWeek: 21, // ceil(21/7)=3 → daily cap = min(3,3) = 3
          backlogThreshold: 1,
        }),
      },
      approvedIdeas: ideas,
      todayArticleCount: 2, // 2 already started today → only 1 more allowed
    });
    mockedQueueArticle.mockResolvedValue({
      jobId: "job-X",
      articleId: "art-X",
      ideaId: "i-X",
      status: "pending",
      alreadyQueued: false,
    });

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.articleJobsStarted).toBe(1);
    expect(mockedQueueArticle).toHaveBeenCalledOnce();
  });

  it("skips when the daily article cap is fully reached", async () => {
    const ideas = Array.from({ length: 3 }, (_, i) => ({
      id: `i-${i}`,
      title: `Idea ${i}`,
    }));
    const client = makePerBlogClient({
      blogRow: {
        id: "blog-1",
        name: "x",
        settings: autopilotSettings({
          maxPostsPerDay: 3,
          generatePerWeek: 21,
          backlogThreshold: 1,
        }),
      },
      approvedIdeas: ideas,
      todayArticleCount: 3, // already at cap
    });

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("daily_article_cap_reached");
    expect(mockedQueueArticle).not.toHaveBeenCalled();
  });

  it("respects dailyTokenBudget when computing how many articles to spawn", async () => {
    const ideas = Array.from({ length: 5 }, (_, i) => ({
      id: `i-${i}`,
      title: `Idea ${i}`,
    }));
    const client = makePerBlogClient({
      blogRow: {
        id: "blog-1",
        name: "x",
        settings: autopilotSettings({
          backlogThreshold: 1,
          // 12-token daily budget; article costs 5 → floor(12/5) = 2 articles
          dailyTokenBudget: 12,
        }),
      },
      approvedIdeas: ideas,
      // No spend yet today.
    });
    mockedQueueArticle.mockResolvedValue({
      jobId: "job-X",
      articleId: "art-X",
      ideaId: "i-X",
      status: "pending",
      alreadyQueued: false,
    });

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.articleJobsStarted).toBe(2);
  });

  it("subtracts tokens already spent today from the dailyTokenBudget", async () => {
    const ideas = Array.from({ length: 5 }, (_, i) => ({
      id: `i-${i}`,
      title: `Idea ${i}`,
    }));
    const client = makePerBlogClient({
      blogRow: {
        id: "blog-1",
        name: "x",
        settings: autopilotSettings({
          backlogThreshold: 1,
          dailyTokenBudget: 25, // 5 articles' worth
        }),
      },
      approvedIdeas: ideas,
      // 15 tokens already spent today → 10 remaining → floor(10/5) = 2
      todayUsageEvents: [
        { credits_used: 5 },
        { credits_used: 5 },
        { credits_used: 5 },
        { credits_used: null }, // ignored — null safely treated as 0
      ],
    });
    mockedQueueArticle.mockResolvedValue({
      jobId: "job-X",
      articleId: "art-X",
      ideaId: "i-X",
      status: "pending",
      alreadyQueued: false,
    });

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.articleJobsStarted).toBe(2);
  });

  it("respects insufficient team token balance", async () => {
    const ideas = Array.from({ length: 5 }, (_, i) => ({
      id: `i-${i}`,
      title: `Idea ${i}`,
    }));
    const client = makePerBlogClient({
      blogRow: {
        id: "blog-1",
        name: "x",
        settings: autopilotSettings({ backlogThreshold: 1 }),
      },
      approvedIdeas: ideas,
    });
    mockedGetTeamPlan.mockResolvedValueOnce({
      ownerId: "owner-1",
      planKey: "starter",
      status: "active",
      balance: 7, // only enough for one 5-token article
    } as never);

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.articleJobsStarted).toBe(1);
  });

  it("never spawns more than PER_RUN_ARTICLE_CAP in a single tick (even when caps allow it)", async () => {
    const ideas = Array.from({ length: 20 }, (_, i) => ({
      id: `i-${i}`,
      title: `Idea ${i}`,
    }));
    const client = makePerBlogClient({
      blogRow: {
        id: "blog-1",
        name: "x",
        settings: autopilotSettings({
          backlogThreshold: 1,
          // Daily cap of 50 — generatePerWeek 350 → ceil/7=50 daily.
          maxPostsPerDay: 50,
          generatePerWeek: 350,
          dailyTokenBudget: null,
        }),
      },
      approvedIdeas: ideas,
    });
    mockedGetTeamPlan.mockResolvedValueOnce({
      ownerId: "owner-1",
      planKey: "scale",
      status: "active",
      balance: 10_000,
    } as never);

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(PER_RUN_ARTICLE_CAP).toBe(5);
    expect(out.articleJobsStarted).toBe(5);
    expect(mockedQueueArticle).toHaveBeenCalledTimes(5);
  });

  it("records partial_failure when some workflow starts succeed and others fail", async () => {
    const ideas = [
      { id: "i-A", title: "A" },
      { id: "i-B", title: "B" },
    ];
    const client = makePerBlogClient({
      blogRow: {
        id: "blog-1",
        name: "x",
        settings: autopilotSettings({ backlogThreshold: 1 }),
      },
      approvedIdeas: ideas,
    });
    mockedQueueArticle
      .mockResolvedValueOnce({
        jobId: "job-A",
        articleId: "art-A",
        ideaId: "i-A",
        status: "pending",
        alreadyQueued: false,
      })
      .mockRejectedValueOnce(new Error("queue failed for B"));

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.status).toBe("completed");
    expect(out.reason).toBe("partial_failure");
    expect(out.articleJobsStarted).toBe(1);
    expect(out.articleJobIds).toEqual(["job-A"]);
  });
});

// ============================================================================
// runAutopilotForBlog — output payload
// ============================================================================

describe("runAutopilotForBlog — output payload", () => {
  it("stamps a budget + backlog snapshot onto the run's output on completion", async () => {
    const client = makePerBlogClient({
      blogRow: {
        id: "blog-1",
        name: "Snapshot blog",
        settings: autopilotSettings({ backlogThreshold: 1 }),
      },
      approvedIdeas: [{ id: "i-A", title: "A" }],
    });
    mockedQueueArticle.mockResolvedValueOnce({
      jobId: "job-A",
      articleId: "art-A",
      ideaId: "i-A",
      status: "pending",
      alreadyQueued: false,
    });

    await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(mockedCompleteRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        status: "completed",
        countersDelta: { ideasGenerated: 0, articlesStarted: 1 },
        output: expect.objectContaining({
          reason: "ok",
          blogName: "Snapshot blog",
          budget: expect.objectContaining({
            tokenBalance: 1000,
            tokensSpentToday: 0,
            tokensRemainingFromBudget: null,
          }),
          spawnedArticleJobIds: ["job-A"],
        }),
      }),
    );
  });

  it("fails the run when an unexpected error escapes the try block", async () => {
    const client = makePerBlogClient();
    // Make the article-jobs count query throw — that runs INSIDE the
    // try, so the catch should mark the run failed.
    client.__chains.article_jobs!.then = ((onFulfilled, onRejected) =>
      Promise.resolve({
        data: null,
        error: { message: "count boom" },
      }).then(
        onFulfilled,
        onRejected,
      )) as typeof client.__chains.article_jobs.then;

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.status).toBe("failed");
    expect(mockedFailRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        errorMessage: "count boom",
      }),
    );
  });

  it("fails the run when the blogs detail-read errors", async () => {
    const client = makePerBlogClient();
    // Override blogs.maybeSingle to error.
    client.__chains.blogs!.maybeSingle = vi.fn().mockResolvedValueOnce({
      data: null,
      error: { message: "blog read boom" },
    }) as never;

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.status).toBe("failed");
    expect(out.reason).toContain("blog read boom");
  });

  it("fails the run when the approved-ideas list errors", async () => {
    const client = makePerBlogClient();
    client.__chains.article_ideas!.then = ((onFulfilled, onRejected) =>
      Promise.resolve({
        data: null,
        error: { message: "ideas read boom" },
      }).then(
        onFulfilled,
        onRejected,
      )) as typeof client.__chains.article_ideas.then;

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.status).toBe("failed");
    expect(out.reason).toContain("ideas read boom");
  });

  it("fails the run when the usage-events lookup errors", async () => {
    const client = makePerBlogClient({
      blogRow: {
        id: "blog-1",
        name: "x",
        // Set a dailyTokenBudget so the scheduler actually queries
        // usage_events (the read is skipped when budget is null).
        // …actually, we sum tokens spent every time, regardless of
        // budget config — the value just isn't compared if there's
        // no budget. So a usage_events failure surfaces either way.
        settings: autopilotSettings(),
      },
    });
    client.__chains.usage_events!.then = ((onFulfilled, onRejected) =>
      Promise.resolve({
        data: null,
        error: { message: "usage read boom" },
      }).then(
        onFulfilled,
        onRejected,
      )) as typeof client.__chains.usage_events.then;

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.status).toBe("failed");
    expect(out.reason).toContain("usage read boom");
  });
});

// ============================================================================
// runBlogAutopilotScheduler — top-level cron entry point
// ============================================================================

describe("runBlogAutopilotScheduler", () => {
  function makeSchedulerClient(opts: {
    eligibleBlogs: Array<{
      id: string;
      project_id: string;
      project: { team_id: string };
    }>;
    perBlogClients?: Record<string, MockClient>;
  }) {
    const blogsListResult = {
      data: opts.eligibleBlogs,
      error: null,
    };
    const client = makeClient({});
    // The scheduler hits `from("blogs")` twice per blog (once for the
    // eligibility filter at the top, once inside loadBlogContext for
    // the row read). Stack the responses on `then` for the list call,
    // and `maybeSingle` for the detail read.
    let blogsListCallCount = 0;
    client.__chains.blogs = makeChain({ data: null, error: null });
    client.__chains.blogs.then = ((onFulfilled, onRejected) => {
      blogsListCallCount += 1;
      return Promise.resolve(blogsListResult).then(
        onFulfilled,
        onRejected,
      );
    }) as typeof client.__chains.blogs.then;
    client.__chains.blogs.maybeSingle = vi.fn(() => {
      // Pretend each per-blog detail read returns a sensible row.
      const blogIndex = Math.max(0, blogsListCallCount - 1);
      const row = opts.eligibleBlogs[blogIndex] ?? opts.eligibleBlogs[0];
      return Promise.resolve({
        data: row
          ? { id: row.id, name: `Blog ${row.id}`, settings: autopilotSettings() }
          : null,
        error: null,
      });
    }) as never;
    // Default empty-backlog state for the per-blog query that fires
    // off the same `client` (when caller doesn't override).
    client.__chains.article_ideas = makeChain({ data: [], error: null });
    client.__chains.article_jobs = makeChain({
      data: null,
      error: null,
      count: 0,
    });
    client.__chains.usage_events = makeChain({ data: [], error: null });

    return client;
  }

  it("returns zeroed totals when there are no eligible blogs", async () => {
    const client = makeSchedulerClient({ eligibleBlogs: [] });

    const out = await runBlogAutopilotScheduler({ client: client as never });

    expect(out).toEqual({
      blogsChecked: 0,
      runsCreated: 0,
      runsSkipped: 0,
      runsFailed: 0,
      ideasGenerated: 0,
      articleJobsStarted: 0,
      errors: [],
      perBlog: [],
    });
    expect(mockedCreateRun).not.toHaveBeenCalled();
  });

  it("filters by jsonb path: settings->automation->>mode='autopilot' AND ->>enabled='true'", async () => {
    const client = makeSchedulerClient({ eligibleBlogs: [] });

    await runBlogAutopilotScheduler({ client: client as never });

    expect(client.__chains.blogs!.filter).toHaveBeenCalledWith(
      "settings->automation->>mode",
      "eq",
      "autopilot",
    );
    expect(client.__chains.blogs!.filter).toHaveBeenCalledWith(
      "settings->automation->>enabled",
      "eq",
      "true",
    );
  });

  it("ticks each eligible blog and rolls counters into the summary", async () => {
    const client = makeSchedulerClient({
      eligibleBlogs: [
        { id: "blog-1", project_id: "p1", project: { team_id: "t1" } },
        { id: "blog-2", project_id: "p2", project: { team_id: "t2" } },
      ],
    });
    // Each blog ticks → empty backlog → idea generation runs once
    // per blog. Stub createRun to return distinct ids.
    let runCounter = 0;
    mockedCreateRun.mockImplementation(async () =>
      ({ id: `run-${++runCounter}` }) as never,
    );

    const out = await runBlogAutopilotScheduler({ client: client as never });

    expect(out.blogsChecked).toBe(2);
    expect(out.ideasGenerated).toBe(4); // 2 ideas per blog
    // Each blog generated ideas → "did productive work" → counts as
    // a completed run. Article spawning is a separate concern.
    expect(out.runsCreated).toBe(2);
    expect(out.runsSkipped).toBe(0);
    expect(out.perBlog).toHaveLength(2);
    expect(out.perBlog.map((b) => b.blogId)).toEqual(["blog-1", "blog-2"]);
  });

  it("records load_blogs error when the eligibility scan fails (no per-blog ticks happen)", async () => {
    const client = makeSchedulerClient({ eligibleBlogs: [] });
    client.__chains.blogs!.then = ((onFulfilled, onRejected) =>
      Promise.resolve({
        data: null,
        error: { message: "supabase down" },
      }).then(onFulfilled, onRejected)) as typeof client.__chains.blogs.then;

    const out = await runBlogAutopilotScheduler({ client: client as never });

    expect(out.errors).toEqual(["load_blogs: supabase down"]);
    expect(out.blogsChecked).toBe(0);
    expect(mockedCreateRun).not.toHaveBeenCalled();
  });

  it("keeps iterating when one blog's createBlogAutopilotRun throws", async () => {
    const client = makeSchedulerClient({
      eligibleBlogs: [
        { id: "blog-1", project_id: "p1", project: { team_id: "t1" } },
        { id: "blog-2", project_id: "p2", project: { team_id: "t2" } },
      ],
    });
    mockedCreateRun
      .mockRejectedValueOnce(new Error("createRun crashed"))
      .mockResolvedValueOnce({ id: "run-2" } as never);

    const out = await runBlogAutopilotScheduler({ client: client as never });

    expect(out.blogsChecked).toBe(2);
    expect(out.errors).toContainEqual(
      expect.stringContaining("blog_blog-1: createRun crashed"),
    );
    expect(out.perBlog[0]).toMatchObject({
      blogId: "blog-1",
      runId: null,
      status: "error",
    });
    expect(out.perBlog[1]).toMatchObject({
      blogId: "blog-2",
      // Default scheduler-client fixture: empty backlog → idea
      // generation runs → run completes (no article spawning, but
      // ideas are productive work).
      status: "completed",
    });
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makeSchedulerClient({ eligibleBlogs: [] });
    mockedCreateAdmin.mockReturnValue(client as never);

    await runBlogAutopilotScheduler();

    expect(mockedCreateAdmin).toHaveBeenCalled();
  });

  it("skips per-blog rows whose joined project link is missing (defensive)", async () => {
    const client = makeSchedulerClient({ eligibleBlogs: [] });
    client.__chains.blogs!.then = ((onFulfilled, onRejected) =>
      Promise.resolve({
        data: [
          // No `project` field — should be filtered out without crashing.
          { id: "orphan-blog", project_id: "p-x" } as unknown as {
            id: string;
            project_id: string;
            project: { team_id: string };
          },
        ],
        error: null,
      }).then(onFulfilled, onRejected)) as typeof client.__chains.blogs.then;

    const out = await runBlogAutopilotScheduler({ client: client as never });
    expect(out.blogsChecked).toBe(0);
  });

  it("falls back to String() in the per-blog error when createBlogAutopilotRun throws a primitive", async () => {
    const client = makeSchedulerClient({
      eligibleBlogs: [
        { id: "blog-1", project_id: "p1", project: { team_id: "t1" } },
      ],
    });
    // Reject with a number — exercises the describeErr fallback for
    // non-Error, non-object-with-message throws.
    mockedCreateRun.mockRejectedValueOnce(42);

    const out = await runBlogAutopilotScheduler({ client: client as never });

    expect(out.errors).toContainEqual(
      expect.stringContaining("blog_blog-1: 42"),
    );
  });

  it("handles the array-shaped FK join (Supabase typed join cardinality fallback)", async () => {
    const client = makeSchedulerClient({ eligibleBlogs: [] });
    client.__chains.blogs!.then = ((onFulfilled, onRejected) =>
      Promise.resolve({
        data: [
          {
            id: "blog-arr",
            project_id: "p1",
            // Some Supabase queries serialize the FK as an array.
            project: [{ team_id: "t1" }],
          } as unknown as {
            id: string;
            project_id: string;
            project: { team_id: string };
          },
        ],
        error: null,
      }).then(onFulfilled, onRejected)) as typeof client.__chains.blogs.then;

    const out = await runBlogAutopilotScheduler({ client: client as never });
    expect(out.blogsChecked).toBe(1);
  });
});

// ============================================================================
// Failure-rate auto-pause policy
// ============================================================================

/**
 * Builds a tiny mock client with a single `blog_autopilot_runs` chain
 * whose `then` resolves with the supplied `count` (and `data: null`).
 * Used by the policy unit tests below; we don't need the full
 * `makePerBlogClient` here because the policy only touches one table.
 */
function makePolicyClient(count: number | null): MockClient {
  const client = makeClient({});
  client.__chains.blog_autopilot_runs = makeChain({
    data: null,
    error: null,
    count,
  });
  return client;
}

describe("shouldPauseAutopilotForFailures", () => {
  it("returns false when failure count is below the default threshold", async () => {
    const client = makePolicyClient(2);
    const out = await shouldPauseAutopilotForFailures({
      blogId: "blog-1",
      client: client as never,
    });
    expect(out).toEqual({
      shouldPause: false,
      failureCount: 2,
      windowMinutes: AUTOPAUSE_FAILURE_WINDOW_MINUTES,
      threshold: AUTOPAUSE_FAILURE_THRESHOLD,
    });
  });

  it("returns true the moment failure count reaches the threshold", async () => {
    const client = makePolicyClient(AUTOPAUSE_FAILURE_THRESHOLD);
    const out = await shouldPauseAutopilotForFailures({
      blogId: "blog-1",
      client: client as never,
    });
    expect(out.shouldPause).toBe(true);
    expect(out.failureCount).toBe(AUTOPAUSE_FAILURE_THRESHOLD);
  });

  it("returns true when failure count exceeds the threshold", async () => {
    const client = makePolicyClient(99);
    const out = await shouldPauseAutopilotForFailures({
      blogId: "blog-1",
      client: client as never,
    });
    expect(out.shouldPause).toBe(true);
    expect(out.failureCount).toBe(99);
  });

  it("treats null count as zero (no pause when query returns no rows)", async () => {
    const client = makePolicyClient(null);
    const out = await shouldPauseAutopilotForFailures({
      blogId: "blog-1",
      client: client as never,
    });
    expect(out.shouldPause).toBe(false);
    expect(out.failureCount).toBe(0);
  });

  it("filters by status='failed' only — skipped/cancelled don't count", async () => {
    const client = makePolicyClient(1);
    await shouldPauseAutopilotForFailures({
      blogId: "blog-policy",
      client: client as never,
    });

    expect(client.__chains.blog_autopilot_runs!.eq).toHaveBeenCalledWith(
      "blog_id",
      "blog-policy",
    );
    expect(client.__chains.blog_autopilot_runs!.eq).toHaveBeenCalledWith(
      "status",
      "failed",
    );
  });

  it("uses the configured window when computing the cutoff timestamp", async () => {
    const client = makePolicyClient(0);
    const now = new Date("2026-05-11T12:00:00.000Z");
    await shouldPauseAutopilotForFailures({
      blogId: "blog-1",
      now,
      failureWindowMinutes: 60,
      client: client as never,
    });

    const cutoff = new Date("2026-05-11T11:00:00.000Z").toISOString();
    expect(client.__chains.blog_autopilot_runs!.gte).toHaveBeenCalledWith(
      "created_at",
      cutoff,
    );
  });

  it("respects a per-call failureThreshold override", async () => {
    const client = makePolicyClient(2);
    const out = await shouldPauseAutopilotForFailures({
      blogId: "blog-1",
      failureThreshold: 2,
      client: client as never,
    });
    expect(out.shouldPause).toBe(true);
    expect(out.threshold).toBe(2);
  });

  it("falls back to the admin client when none is supplied", async () => {
    const client = makePolicyClient(0);
    mockedCreateAdmin.mockReturnValueOnce(client as never);

    await shouldPauseAutopilotForFailures({ blogId: "blog-1" });
    expect(mockedCreateAdmin).toHaveBeenCalledTimes(1);
  });

  it("propagates the supabase error so the caller's catch can swallow it", async () => {
    const client = makeClient({});
    client.__chains.blog_autopilot_runs = makeChain({
      data: null,
      error: { message: "db down" },
      count: null,
    });
    await expect(
      shouldPauseAutopilotForFailures({
        blogId: "blog-1",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "db down" });
  });
});

describe("pauseAutopilotForBlog", () => {
  it("flips enabled=false and stamps pause metadata while preserving mode + other fields", async () => {
    const blogRow = {
      id: "blog-pause",
      settings: {
        identity: { language: "en" },
        automation: {
          mode: "autopilot",
          enabled: true,
          generatePerWeek: 7,
          backlogThreshold: 10,
        },
      },
    };
    const client = makeClient({});
    client.__chains.blogs = makeChain({ data: blogRow, error: null });

    const now = new Date("2026-05-11T12:00:00.000Z");
    await pauseAutopilotForBlog(
      client as never,
      "blog-pause",
      PAUSED_REASON_FAILURE_RATE,
      PAUSED_MESSAGE_FAILURE_RATE,
      now,
    );

    expect(client.__chains.blogs!.update).toHaveBeenCalledTimes(1);
    const updateArg = client.__chains.blogs!.update.mock.calls[0]![0] as {
      settings: {
        identity: Record<string, unknown>;
        automation: Record<string, unknown>;
      };
    };
    expect(updateArg.settings.identity).toEqual({ language: "en" });
    expect(updateArg.settings.automation).toEqual({
      mode: "autopilot",
      enabled: false,
      generatePerWeek: 7,
      backlogThreshold: 10,
      pausedReason: PAUSED_REASON_FAILURE_RATE,
      pausedAt: now.toISOString(),
      pausedMessage: PAUSED_MESSAGE_FAILURE_RATE,
    });
  });

  it("handles a blog with empty settings jsonb (no automation key yet)", async () => {
    const client = makeClient({});
    client.__chains.blogs = makeChain({
      data: { id: "blog-1", settings: null },
      error: null,
    });

    await pauseAutopilotForBlog(
      client as never,
      "blog-1",
      "failure_rate",
      "msg",
    );

    const updateArg = client.__chains.blogs!.update.mock.calls[0]![0] as {
      settings: { automation: Record<string, unknown> };
    };
    expect(updateArg.settings.automation).toMatchObject({
      enabled: false,
      pausedReason: "failure_rate",
      pausedMessage: "msg",
    });
  });

  it("handles a blog whose automation key is non-object (corrupt jsonb)", async () => {
    const client = makeClient({});
    client.__chains.blogs = makeChain({
      data: { id: "blog-1", settings: { automation: "broken" } },
      error: null,
    });

    await pauseAutopilotForBlog(
      client as never,
      "blog-1",
      "failure_rate",
      "msg",
    );

    const updateArg = client.__chains.blogs!.update.mock.calls[0]![0] as {
      settings: { automation: Record<string, unknown> };
    };
    expect(updateArg.settings.automation.enabled).toBe(false);
  });

  it("propagates the read error so the caller's catch can swallow it", async () => {
    const client = makeClient({});
    client.__chains.blogs = makeChain({
      data: null,
      error: { message: "read failed" },
    });
    client.__chains.blogs.maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "read failed" },
    });

    await expect(
      pauseAutopilotForBlog(client as never, "blog-1", "r", "m"),
    ).rejects.toEqual({ message: "read failed" });
  });
});

// ============================================================================
// runAutopilotForBlog — integration with auto-pause
// ============================================================================

/**
 * Wires up a per-blog client with an explicit `blog_autopilot_runs`
 * count so the test controls how many recent failures the policy
 * "sees" after the current run is marked failed.
 */
function makePerBlogClientWithFailureCount(
  failureCount: number,
  opts: PerBlogClientOpts = {},
): MockClient {
  const client = makePerBlogClient(opts);
  // Override the on-demand chain so the count query for the policy
  // returns what the test wants. Selecting/.maybeSingle for the
  // `mergeAutopilotRunOutput` read needs to return *something*
  // shaped like a row, otherwise the merge bails defensively
  // without writing the stamp.
  client.__chains.blog_autopilot_runs = makeChain({
    data: { output: {} },
    error: null,
    count: failureCount,
  });
  return client;
}

describe("runAutopilotForBlog — failure-rate auto-pause", () => {
  it("does NOT pause when only one recent run has failed (below threshold)", async () => {
    const client = makePerBlogClientWithFailureCount(1, { approvedIdeas: [] });
    mockedGenerateIdeas.mockRejectedValueOnce(new Error("Claude down"));

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.status).toBe("failed");
    // No autopilotPaused flag in the result's output.
    expect(out.output.autopilotPaused).toBeUndefined();
    // No settings update — the blog is left armed.
    expect(client.__chains.blogs!.update).not.toHaveBeenCalled();
  });

  it("pauses the blog and stamps autopilotPaused on the run when threshold is reached", async () => {
    const client = makePerBlogClientWithFailureCount(
      AUTOPAUSE_FAILURE_THRESHOLD,
      { approvedIdeas: [] },
    );
    mockedGenerateIdeas.mockRejectedValueOnce(new Error("Claude down again"));

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      triggerSource: "manual",
      client: client as never,
    });

    expect(out.status).toBe("failed");
    expect(out.output).toMatchObject({
      autopilotPaused: true,
      pauseReason: PAUSED_REASON_FAILURE_RATE,
      failureCount: AUTOPAUSE_FAILURE_THRESHOLD,
    });

    // blogs.update was called with enabled=false + paused metadata,
    // mode preserved.
    expect(client.__chains.blogs!.update).toHaveBeenCalledTimes(1);
    const blogUpdate = client.__chains.blogs!.update.mock.calls[0]![0] as {
      settings: { automation: Record<string, unknown> };
    };
    expect(blogUpdate.settings.automation).toMatchObject({
      mode: "autopilot",
      enabled: false,
      pausedReason: PAUSED_REASON_FAILURE_RATE,
      pausedMessage: PAUSED_MESSAGE_FAILURE_RATE,
    });
    expect(typeof blogUpdate.settings.automation.pausedAt).toBe("string");

    // run.output gets the autopilotPaused stamp via the merge helper.
    expect(client.__chains.blog_autopilot_runs!.update).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          autopilotPaused: true,
          pauseReason: PAUSED_REASON_FAILURE_RATE,
        }),
      }),
    );
  });

  it("does NOT pause from the outer catch when failure count is below threshold", async () => {
    const client = makePerBlogClientWithFailureCount(0, { approvedIdeas: [] });
    // getTeamPlan throwing escapes into the outer catch.
    mockedGetTeamPlan.mockRejectedValueOnce(new Error("billing down"));

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.status).toBe("failed");
    expect(out.output.autopilotPaused).toBeUndefined();
    expect(client.__chains.blogs!.update).not.toHaveBeenCalled();
  });

  it("pauses from the outer catch when failure count meets threshold", async () => {
    const client = makePerBlogClientWithFailureCount(
      AUTOPAUSE_FAILURE_THRESHOLD + 2,
      { approvedIdeas: [] },
    );
    mockedGetTeamPlan.mockRejectedValueOnce(new Error("billing down"));

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.status).toBe("failed");
    expect(out.output.autopilotPaused).toBe(true);
    expect(out.output.pauseReason).toBe(PAUSED_REASON_FAILURE_RATE);
    expect(client.__chains.blogs!.update).toHaveBeenCalledTimes(1);
  });

  it("does NOT pause on a skipped run even if recent failures exist", async () => {
    // Backlog already met → no idea gen → no failure to count;
    // and no approved ideas → skipped with reason 'no_approved_ideas'.
    const client = makePerBlogClientWithFailureCount(99, {
      blogRow: {
        id: "blog-1",
        name: "B",
        settings: autopilotSettings({ backlogThreshold: 0 }),
      },
      approvedIdeas: [],
    });

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.status).toBe("skipped");
    // Crucial: skipped runs never trigger the auto-pause path.
    expect(client.__chains.blogs!.update).not.toHaveBeenCalled();
  });

  it("still records the pause on settings even when the run-output stamp read fails", async () => {
    // Pauses succeed (blogs.update fires), but the secondary
    // mergeAutopilotRunOutput read throws — the inner catch
    // swallows it so the user-facing pause still lands.
    const client = makePerBlogClientWithFailureCount(
      AUTOPAUSE_FAILURE_THRESHOLD,
      { approvedIdeas: [] },
    );
    // Override maybeSingle on the runs chain to fail (count query
    // uses .then, which still resolves cleanly with count=3).
    client.__chains.blog_autopilot_runs!.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "merge read failed" } });
    mockedGenerateIdeas.mockRejectedValueOnce(new Error("Claude down"));

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(out.status).toBe("failed");
    expect(out.output.autopilotPaused).toBe(true);
    expect(client.__chains.blogs!.update).toHaveBeenCalledTimes(1);
    // The output stamp was attempted but skipped — no update against runs.
    expect(client.__chains.blog_autopilot_runs!.update).not.toHaveBeenCalled();
  });

  it("starts the run.output stamp from {} when the existing output is null", async () => {
    // Exercises the `currentOutput = ... : {}` fallback inside
    // mergeAutopilotRunOutput when the just-failed run row has
    // null/non-object output (legacy or corrupt jsonb).
    const client = makePerBlogClientWithFailureCount(
      AUTOPAUSE_FAILURE_THRESHOLD,
      { approvedIdeas: [] },
    );
    client.__chains.blog_autopilot_runs!.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { output: null }, error: null });
    mockedGenerateIdeas.mockRejectedValueOnce(new Error("Claude down"));

    await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(client.__chains.blog_autopilot_runs!.update).toHaveBeenCalledWith({
      output: {
        autopilotPaused: true,
        pauseReason: PAUSED_REASON_FAILURE_RATE,
      },
    });
  });

  it("counts manual triggerSource failures alongside cron failures (single shared threshold)", async () => {
    // The policy query doesn't filter by trigger_source, so a manual
    // failure that brings the count to threshold pauses just like a
    // cron failure would. Verify by inspecting the recorded eq calls.
    const client = makePerBlogClientWithFailureCount(
      AUTOPAUSE_FAILURE_THRESHOLD,
      { approvedIdeas: [] },
    );
    mockedGenerateIdeas.mockRejectedValueOnce(new Error("nope"));

    await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      triggerSource: "manual",
      client: client as never,
    });

    // The policy query never narrows by trigger_source.
    const eqCalls = client.__chains.blog_autopilot_runs!.eq.mock.calls.map(
      (c) => c[0],
    );
    expect(eqCalls).not.toContain("trigger_source");
  });
});

// ============================================================================
// Auto-approve ideas — helper unit tests
// ============================================================================

describe("autoApproveIdeasForAutopilotRun", () => {
  it("short-circuits when the id list is empty (no query, count=0)", async () => {
    const client = makeClient({});
    const out = await autoApproveIdeasForAutopilotRun({
      blogId: "blog-1",
      ideaIds: [],
      client: client as never,
    });
    expect(out.approvedCount).toBe(0);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("filters by blog_id + status='generated' + id IN (ideaIds) and returns count", async () => {
    const client = makeClient({});
    client.__chains.article_ideas = makeChain({
      data: [{ id: "i-A" }, { id: "i-B" }],
      error: null,
    });

    const out = await autoApproveIdeasForAutopilotRun({
      blogId: "blog-AA",
      ideaIds: ["i-A", "i-B", "i-C"],
      client: client as never,
    });

    expect(out.approvedCount).toBe(2);
    // Update payload sets status=approved.
    expect(client.__chains.article_ideas!.update).toHaveBeenCalledWith({
      status: "approved",
    });
    // Defense-in-depth filters all present.
    const eqCalls = client.__chains.article_ideas!.eq.mock.calls.map(
      (c) => [c[0], c[1]] as const,
    );
    expect(eqCalls).toContainEqual(["blog_id", "blog-AA"]);
    expect(eqCalls).toContainEqual(["status", "generated"]);
    expect(client.__chains.article_ideas!.in).toHaveBeenCalledWith("id", [
      "i-A",
      "i-B",
      "i-C",
    ]);
  });

  it("returns the *actual* approved count, not the input length (race-safe)", async () => {
    // 3 ideas requested but only 1 was still in 'generated' status —
    // the other two were already approved/rejected by the user.
    const client = makeClient({});
    client.__chains.article_ideas = makeChain({
      data: [{ id: "i-A" }],
      error: null,
    });

    const out = await autoApproveIdeasForAutopilotRun({
      blogId: "blog-1",
      ideaIds: ["i-A", "i-B", "i-C"],
      client: client as never,
    });
    expect(out.approvedCount).toBe(1);
  });

  it("propagates supabase errors so the caller can mark the run failed", async () => {
    const client = makeClient({});
    client.__chains.article_ideas = makeChain({
      data: null,
      error: { message: "rls denied" },
    });
    await expect(
      autoApproveIdeasForAutopilotRun({
        blogId: "blog-1",
        ideaIds: ["i-A"],
        client: client as never,
      }),
    ).rejects.toEqual({ message: "rls denied" });
  });

  it("falls back to the admin client when none is supplied", async () => {
    const client = makeClient({});
    client.__chains.article_ideas = makeChain({
      data: [{ id: "i-A" }],
      error: null,
    });
    mockedCreateAdmin.mockReturnValueOnce(client as never);

    const out = await autoApproveIdeasForAutopilotRun({
      blogId: "blog-1",
      ideaIds: ["i-A"],
    });
    expect(mockedCreateAdmin).toHaveBeenCalledTimes(1);
    expect(out.approvedCount).toBe(1);
  });
});

// ============================================================================
// runAutopilotForBlog — auto-approve integration
// ============================================================================

/**
 * Variant of {@link makePerBlogClient} that pre-arms the
 * `article_ideas` chain to return a specific update count, so tests
 * can assert how many ideas got auto-approved.
 */
function makePerBlogClientForAutoApprove(opts: {
  approvedIdeas?: Array<{ id: string; title: string }>;
  blogRow?: PerBlogClientOpts["blogRow"];
  /** Rows the auto-approve update returns from `.select("id")`. */
  autoApprovedRows?: Array<{ id: string }>;
  todayArticleCount?: number;
}): MockClient {
  const client = makePerBlogClient({
    approvedIdeas: opts.approvedIdeas ?? [],
    blogRow: opts.blogRow,
    todayArticleCount: opts.todayArticleCount,
  });
  // Override the article_ideas chain so the auto-approve `.select("id")`
  // hand returns whatever the test wants. The same chain instance also
  // serves the prior `listApprovedIdeasForBlog` call via `then`, so
  // we keep that data alongside.
  const approvedIdeas = opts.approvedIdeas ?? [];
  client.__chains.article_ideas = makeChain({
    data: opts.autoApprovedRows ?? approvedIdeas,
    error: null,
  });
  return client;
}

describe("runAutopilotForBlog — auto-approve gate", () => {
  it("does NOT call auto-approve when requireReview=true (default)", async () => {
    const client = makePerBlogClient({ approvedIdeas: [] });
    // Spy on the article_ideas update — should never fire as a
    // side-effect of auto-approve when requireReview is on.
    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });
    expect(out.status).toBe("completed");
    // article_ideas.update is the only signal a write happened.
    expect(client.__chains.article_ideas!.update).not.toHaveBeenCalled();
  });

  it("does NOT call auto-approve when requireReview=false but no ideas were generated", async () => {
    // Backlog already meets threshold → idea-gen branch skipped →
    // nothing for auto-approve to do this tick.
    const client = makePerBlogClientForAutoApprove({
      blogRow: {
        id: "blog-1",
        name: "Plenty",
        settings: autopilotSettings({
          requireReview: false,
          backlogThreshold: 1,
        }),
      },
      approvedIdeas: [{ id: "i-existing", title: "X" }],
    });
    await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });
    expect(client.__chains.article_ideas!.update).not.toHaveBeenCalled();
  });

  it("auto-approves freshly-generated ideas when requireReview=false", async () => {
    const client = makePerBlogClientForAutoApprove({
      blogRow: {
        id: "blog-1",
        name: "Hands-off",
        settings: autopilotSettings({
          requireReview: false,
          backlogThreshold: 5, // empty backlog → idea-gen fires
        }),
      },
      approvedIdeas: [],
      autoApprovedRows: [{ id: "i-A" }, { id: "i-B" }],
    });

    await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    // The update was called with status=approved.
    expect(client.__chains.article_ideas!.update).toHaveBeenCalledWith({
      status: "approved",
    });
    // The .in("id", [...]) call carried the freshly-generated idea ids
    // — and ONLY those ids. Manual / older-run `generated` ideas are
    // never in this list because the helper scopes to the current
    // run's batch.
    expect(client.__chains.article_ideas!.in).toHaveBeenCalledWith(
      "id",
      ["i-A", "i-B"],
    );
  });

  it("does NOT auto-approve when input.dryRun=true (test runs are read-only)", async () => {
    const client = makePerBlogClientForAutoApprove({
      blogRow: {
        id: "blog-1",
        name: "Dry",
        settings: autopilotSettings({
          requireReview: false,
          backlogThreshold: 5,
        }),
      },
      approvedIdeas: [],
    });

    await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      dryRun: true,
      client: client as never,
    });
    expect(client.__chains.article_ideas!.update).not.toHaveBeenCalled();
  });

  it("stamps ideasAutoApproved + requireReview onto the run output", async () => {
    const client = makePerBlogClientForAutoApprove({
      blogRow: {
        id: "blog-1",
        name: "Stamp",
        settings: autopilotSettings({
          requireReview: false,
          backlogThreshold: 5,
        }),
      },
      approvedIdeas: [],
      autoApprovedRows: [{ id: "i-A" }, { id: "i-B" }],
    });

    await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    // Either completed or skipped (depending on whether spawning
    // succeeded) — the output stamp lands either way. Look at the
    // last completeBlogAutopilotRun call.
    const completeCall =
      mockedCompleteRun.mock.calls[mockedCompleteRun.mock.calls.length - 1]!;
    const arg = completeCall[0] as { output: Record<string, unknown> };
    expect(arg.output).toMatchObject({
      ideasAutoApproved: 2,
      requireReview: false,
    });
  });

  it("stamps ideasAutoApproved=0 + requireReview=true on a normal review-on run", async () => {
    // Even when no auto-approve happened, the stamp keeps the
    // operator-readable output consistent.
    const client = makePerBlogClient({
      blogRow: {
        id: "blog-1",
        name: "Stamp",
        settings: autopilotSettings({
          requireReview: true,
          backlogThreshold: 5,
        }),
      },
      approvedIdeas: [],
    });

    await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    const completeCall =
      mockedCompleteRun.mock.calls[mockedCompleteRun.mock.calls.length - 1]!;
    const arg = completeCall[0] as { output: Record<string, unknown> };
    expect(arg.output).toMatchObject({
      ideasAutoApproved: 0,
      requireReview: true,
    });
  });

  it("does not auto-approve previously-generated ideas from older runs (defense in depth via .in())", async () => {
    // Simulate the existence of an old `generated` idea by passing
    // it via approvedIdeas (the integration only calls auto-approve
    // for the current run's `batch.ideas` ids, so the old idea is
    // never even named in the .in() arg).
    mockedGenerateIdeas.mockResolvedValueOnce({
      jobId: "job-ideas",
      ideas: [{ id: "i-NEW-1", title: "n1" } as never],
    } as never);

    const client = makePerBlogClientForAutoApprove({
      blogRow: {
        id: "blog-1",
        name: "Scope",
        settings: autopilotSettings({
          requireReview: false,
          backlogThreshold: 5,
        }),
      },
      approvedIdeas: [],
      autoApprovedRows: [{ id: "i-NEW-1" }],
    });

    await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    // Only the newly generated id appears in .in() — the old id
    // ("i-OLD") never makes it into the auto-approve scope, even
    // though it's still status=generated in the wider system.
    const inCalls = client.__chains.article_ideas!.in.mock.calls;
    const lastInCall = inCalls[inCalls.length - 1];
    expect(lastInCall).toEqual(["id", ["i-NEW-1"]]);
  });

  it("respects PER_RUN_ARTICLE_CAP / daily caps even when auto-approve produces more ideas", async () => {
    // Auto-approve creates 7 fresh ideas, but per-run cap is 5 +
    // daily cap is 3 (autopilotSettings: maxPostsPerDay=3,
    // generatePerWeek=14 → daily=2 → max(2,3)=3 effective). At
    // most 3 article workflows should start.
    mockedGenerateIdeas.mockResolvedValueOnce({
      jobId: "job-ideas",
      ideas: [
        { id: "n1", title: "n1" } as never,
        { id: "n2", title: "n2" } as never,
        { id: "n3", title: "n3" } as never,
        { id: "n4", title: "n4" } as never,
        { id: "n5", title: "n5" } as never,
        { id: "n6", title: "n6" } as never,
        { id: "n7", title: "n7" } as never,
      ],
    } as never);

    // After auto-approve the next listApprovedIdeasForBlog call
    // should return all 7. We can't easily intercept the per-call
    // result without a per-call override; reuse the chain instead.
    const client = makePerBlogClientForAutoApprove({
      blogRow: {
        id: "blog-1",
        name: "Cap",
        settings: autopilotSettings({
          requireReview: false,
          backlogThreshold: 10,
          maxPostsPerDay: 3,
          generatePerWeek: 14,
        }),
      },
      approvedIdeas: [
        { id: "n1", title: "n1" },
        { id: "n2", title: "n2" },
        { id: "n3", title: "n3" },
        { id: "n4", title: "n4" },
        { id: "n5", title: "n5" },
        { id: "n6", title: "n6" },
        { id: "n7", title: "n7" },
      ],
      autoApprovedRows: [{ id: "n1" }, { id: "n2" }, { id: "n3" }, { id: "n4" }, { id: "n5" }, { id: "n6" }, { id: "n7" }],
    });

    mockedQueueArticle.mockResolvedValue({
      jobId: "job-x",
      articleId: "art-x",
    } as never);

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });

    // Daily cap (3) wins over per-run cap (5) and over auto-approved
    // pool (7). Even with auto-approve, the safety caps still rule.
    expect(out.articleJobsStarted).toBeLessThanOrEqual(3);
  });

  it("auto-pause behavior is unchanged when auto-approve is on (still pauses on threshold)", async () => {
    // Auto-approve flag has no bearing on the failure-rate policy —
    // a failing run in requireReview=false land still trips the
    // pause check.
    const client = makePerBlogClientForAutoApprove({
      blogRow: {
        id: "blog-1",
        name: "PauseStill",
        settings: autopilotSettings({
          requireReview: false,
          backlogThreshold: 5,
        }),
      },
      approvedIdeas: [],
    });
    // Force the failure path.
    mockedGenerateIdeas.mockRejectedValueOnce(new Error("Claude down"));
    // Make policy count tip over.
    client.__chains.blog_autopilot_runs = makeChain({
      data: { output: {} },
      error: null,
      count: AUTOPAUSE_FAILURE_THRESHOLD,
    });

    const out = await runAutopilotForBlog({
      teamId: "t1",
      projectId: "p1",
      blogId: "blog-1",
      client: client as never,
    });
    expect(out.status).toBe("failed");
    expect(out.output.autopilotPaused).toBe(true);
  });
});
