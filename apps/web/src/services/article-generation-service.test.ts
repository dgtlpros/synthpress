import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/ai/provider", () => ({
  generateIdeas: vi.fn(),
  generateArticleDraft: vi.fn(),
  IDEA_DEFAULT_COUNT: 10,
}));

vi.mock("./team-billing-service", () => ({
  consumeTeamTokens: vi.fn(),
  refundTeamTokens: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { generateArticleDraft, generateIdeas } from "@/lib/ai/provider";
import { consumeTeamTokens, refundTeamTokens } from "./team-billing-service";
import {
  ARTICLE_IDEA_STATUSES,
  ARTICLE_JOB_STATUSES,
  ARTICLE_JOB_STEPS,
  ARTICLE_JOB_TYPES,
  IDEA_STATUS_TRANSITIONS,
  PROVIDER_ANTHROPIC,
  TRIGGER_SOURCES,
  buildBriefFromIdea,
  completeArticleJob,
  convertIdeaToArticle,
  createArticleJob,
  failArticleJob,
  generateArticleDraftFromIdea,
  generateArticleIdeas,
  ACTIVE_JOB_RECENT_WINDOW_MS,
  DEFAULT_RECONCILE_THRESHOLDS_MINUTES,
  getActiveGenerateArticleIdeaIds,
  getBlogGenerationContext,
  isAllowedIdeaStatusTransition,
  listActiveArticleJobsForUser,
  listArticleIdeasForBlog,
  logUsageEvent,
  queueGenerateArticleFromIdea,
  queueGenerateArticleIdeas,
  reconcileStuckArticleJobs,
  runGenerateArticleFromIdeaJob,
  runGenerateArticleIdeasJob,
  updateArticleIdeaStatus,
  updateArticleJobStatus,
} from "./article-generation-service";

const mockedGenerateIdeas = vi.mocked(generateIdeas);
const mockedGenerateArticleDraft = vi.mocked(generateArticleDraft);
const mockedConsumeTeamTokens = vi.mocked(consumeTeamTokens);
const mockedRefundTeamTokens = vi.mocked(refundTeamTokens);

const mockedCreateAdmin = vi.mocked(createAdminClient);

// ---- Mock Supabase chain helpers ----------------------------------------

interface ChainResult<T> {
  data: T;
  error: { code?: string; message?: string } | null;
}

function makeChain<T>(result: ChainResult<T>) {
  // The mock chain is both chainable AND directly awaitable: every
  // `.select()/.eq()/.in()/.order()/.limit()/.insert()/.update()` returns
  // `this`, but the chain itself implements `.then()`, so callers can
  // either keep chaining or `await` at any point. This matches how
  // `@supabase/postgrest-js` actually behaves and lets us swap terminal
  // calls (e.g. `.order()` → `.in().order().limit()` for the new
  // idempotency check) without rewriting every test fixture.
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    then: ((onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected)) as PromiseLike<
      ChainResult<T>
    >["then"],
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ============================================================================
// Constants
// ============================================================================

describe("constants", () => {
  it("exposes the four article-job types", () => {
    expect(ARTICLE_JOB_TYPES).toEqual([
      "generate_ideas",
      "generate_outline",
      "generate_article",
    ]);
  });

  it("exposes the five article-job statuses", () => {
    expect(ARTICLE_JOB_STATUSES).toEqual([
      "pending",
      "processing",
      "completed",
      "failed",
      "cancelled",
    ]);
  });

  it("exposes the known workflow steps", () => {
    expect(ARTICLE_JOB_STEPS).toContain("loading_context");
    expect(ARTICLE_JOB_STEPS).toContain("generating_ideas");
    expect(ARTICLE_JOB_STEPS).toContain("generating_outline");
    expect(ARTICLE_JOB_STEPS).toContain("writing_article");
    expect(ARTICLE_JOB_STEPS).toContain("saving_article");
    expect(ARTICLE_JOB_STEPS).toContain("logging_usage");
    expect(ARTICLE_JOB_STEPS).toContain("completed");
  });

  it("exposes the four article-idea lifecycle statuses", () => {
    expect(ARTICLE_IDEA_STATUSES).toEqual([
      "generated",
      "approved",
      "rejected",
      "converted_to_article",
    ]);
  });

  it("exports the canonical provider name", () => {
    expect(PROVIDER_ANTHROPIC).toBe("anthropic");
  });

  it("exposes the three trigger sources", () => {
    expect(TRIGGER_SOURCES).toEqual(["manual", "autopilot", "workflow"]);
  });

  it("includes saving_ideas in the workflow steps", () => {
    expect(ARTICLE_JOB_STEPS).toContain("saving_ideas");
  });
});

// ============================================================================
// createArticleJob
// ============================================================================

describe("createArticleJob", () => {
  it("inserts a job row with the supplied fields and returns it", async () => {
    const inserted = {
      id: "job-1",
      blog_id: "b1",
      type: "generate_article",
      status: "pending",
      user_id: "u1",
      attempts: 0,
    };
    const client = makeClient({
      article_jobs: { data: inserted, error: null },
    });

    const result = await createArticleJob({
      blogId: "b1",
      type: "generate_article",
      userId: "u1",
      input: { brief: "How to ship faster" },
      client: client as never,
    });

    expect(result).toEqual(inserted);
    expect(client.__chains.article_jobs!.insert).toHaveBeenCalledWith({
      blog_id: "b1",
      type: "generate_article",
      user_id: "u1",
      status: "pending",
      article_id: null,
      article_idea_id: null,
      input: { brief: "How to ship faster" },
    });
  });

  it("uses the admin client when none is injected", async () => {
    const client = makeClient({
      article_jobs: { data: { id: "job-2" }, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await createArticleJob({
      blogId: "b1",
      type: "generate_ideas",
      userId: "u1",
    });

    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });

  it("threads through optional links and a custom initial status", async () => {
    const client = makeClient({
      article_jobs: { data: { id: "job-3" }, error: null },
    });

    await createArticleJob({
      blogId: "b1",
      type: "generate_outline",
      userId: "u1",
      articleId: "a1",
      articleIdeaId: "i1",
      status: "processing",
      client: client as never,
    });

    expect(client.__chains.article_jobs!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        article_id: "a1",
        article_idea_id: "i1",
        status: "processing",
      }),
    );
  });

  it("defaults input to an empty object when none is provided", async () => {
    const client = makeClient({
      article_jobs: { data: { id: "job-4" }, error: null },
    });

    await createArticleJob({
      blogId: "b1",
      type: "generate_ideas",
      userId: "u1",
      client: client as never,
    });

    expect(client.__chains.article_jobs!.insert).toHaveBeenCalledWith(
      expect.objectContaining({ input: {} }),
    );
  });

  it("propagates supabase insert errors", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: { message: "boom" } },
    });

    await expect(
      createArticleJob({
        blogId: "b1",
        type: "generate_ideas",
        userId: "u1",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "boom" });
  });
});

// ============================================================================
// updateArticleJobStatus
// ============================================================================

describe("updateArticleJobStatus", () => {
  it("issues a partial update for the supplied fields", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: null },
    });

    await updateArticleJobStatus({
      jobId: "job-1",
      currentStep: "writing_article",
      client: client as never,
    });

    const chain = client.__chains.article_jobs!;
    expect(chain.update).toHaveBeenCalledWith({
      current_step: "writing_article",
    });
    expect(chain.eq).toHaveBeenCalledWith("id", "job-1");
  });

  it("stamps started_at when the status moves to processing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T15:00:00Z"));

    const client = makeClient({
      article_jobs: { data: null, error: null },
    });

    await updateArticleJobStatus({
      jobId: "job-1",
      status: "processing",
      client: client as never,
    });

    expect(client.__chains.article_jobs!.update).toHaveBeenCalledWith({
      status: "processing",
      started_at: "2026-05-07T15:00:00.000Z",
    });
  });

  it("records error_message when supplied", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: null },
    });

    await updateArticleJobStatus({
      jobId: "job-1",
      errorMessage: "rate limited",
      client: client as never,
    });

    expect(client.__chains.article_jobs!.update).toHaveBeenCalledWith({
      error_message: "rate limited",
    });
  });

  it("increments attempts via a read-then-write when requested", async () => {
    const client = makeClient({
      article_jobs: { data: { attempts: 2 }, error: null },
    });

    await updateArticleJobStatus({
      jobId: "job-1",
      status: "processing",
      incrementAttempts: true,
      client: client as never,
    });

    const updateArg = client.__chains.article_jobs!.update.mock.calls[0]![0];
    expect(updateArg).toMatchObject({ attempts: 3, status: "processing" });
    expect(updateArg.started_at).toBeDefined();
  });

  it("handles a missing existing row by treating attempts as 0", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: null },
    });

    await updateArticleJobStatus({
      jobId: "job-1",
      incrementAttempts: true,
      client: client as never,
    });

    expect(client.__chains.article_jobs!.update).toHaveBeenCalledWith({
      attempts: 1,
    });
  });

  it("propagates supabase errors from the read-then-write attempt counter", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: { message: "select boom" } },
    });

    await expect(
      updateArticleJobStatus({
        jobId: "job-1",
        incrementAttempts: true,
        client: client as never,
      }),
    ).rejects.toEqual({ message: "select boom" });
  });

  it("propagates supabase errors from the update", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: null },
    });
    // Override the chained `eq` to return an error after `update` chain.
    const chain = client.__chains.article_jobs!;
    // Make `update().eq()` resolve with an error
    chain.eq = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "update boom" } });

    await expect(
      updateArticleJobStatus({
        jobId: "job-1",
        status: "completed",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "update boom" });
  });

  it("uses the admin client when none is injected", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await updateArticleJobStatus({
      jobId: "job-1",
      currentStep: "logging_usage",
    });

    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// completeArticleJob
// ============================================================================

describe("completeArticleJob", () => {
  it("marks the job completed and stamps completed_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T16:00:00Z"));

    const client = makeClient({
      article_jobs: { data: null, error: null },
    });

    await completeArticleJob({
      jobId: "job-1",
      output: { promptTokens: 100 },
      articleId: "a1",
      articleIdeaId: "i1",
      client: client as never,
    });

    expect(client.__chains.article_jobs!.update).toHaveBeenCalledWith({
      status: "completed",
      current_step: "completed",
      completed_at: "2026-05-07T16:00:00.000Z",
      output: { promptTokens: 100 },
      article_id: "a1",
      article_idea_id: "i1",
    });
  });

  it("works without optional fields", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: null },
    });

    await completeArticleJob({
      jobId: "job-1",
      client: client as never,
    });

    const updateArg = client.__chains.article_jobs!.update.mock.calls[0]![0];
    expect(updateArg).toMatchObject({
      status: "completed",
      current_step: "completed",
    });
    expect(updateArg.output).toBeUndefined();
    expect(updateArg.article_id).toBeUndefined();
    expect(updateArg.article_idea_id).toBeUndefined();
  });

  it("propagates supabase errors", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: null },
    });
    client.__chains.article_jobs!.eq = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(
      completeArticleJob({ jobId: "job-1", client: client as never }),
    ).rejects.toEqual({ message: "boom" });
  });

  it("uses the admin client when none is injected", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await completeArticleJob({ jobId: "job-1" });

    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// failArticleJob
// ============================================================================

describe("failArticleJob", () => {
  it("marks the job failed with the error message and timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T17:00:00Z"));

    const client = makeClient({
      article_jobs: { data: null, error: null },
    });

    await failArticleJob({
      jobId: "job-1",
      errorMessage: "anthropic timeout",
      output: { partial: "draft started" },
      client: client as never,
    });

    expect(client.__chains.article_jobs!.update).toHaveBeenCalledWith({
      status: "failed",
      error_message: "anthropic timeout",
      completed_at: "2026-05-07T17:00:00.000Z",
      output: { partial: "draft started" },
    });
  });

  it("omits output when none is provided", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: null },
    });

    await failArticleJob({
      jobId: "job-1",
      errorMessage: "x",
      client: client as never,
    });

    const updateArg = client.__chains.article_jobs!.update.mock.calls[0]![0];
    expect(updateArg.output).toBeUndefined();
  });

  it("propagates supabase errors", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: null },
    });
    client.__chains.article_jobs!.eq = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(
      failArticleJob({
        jobId: "job-1",
        errorMessage: "x",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "boom" });
  });

  it("uses the admin client when none is injected", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await failArticleJob({ jobId: "job-1", errorMessage: "x" });

    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// logUsageEvent
// ============================================================================

describe("logUsageEvent", () => {
  it("inserts a usage_event row with the provided fields", async () => {
    const client = makeClient({
      usage_events: { data: null, error: null },
    });

    await logUsageEvent({
      userId: "u1",
      blogId: "b1",
      articleId: "a1",
      articleIdeaId: "i1",
      jobId: "job-1",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1500,
      outputTokens: 850,
      estimatedCost: 0.0367,
      creditsUsed: 5,
      client: client as never,
    });

    expect(client.__chains.usage_events!.insert).toHaveBeenCalledWith({
      user_id: "u1",
      blog_id: "b1",
      article_id: "a1",
      article_idea_id: "i1",
      job_id: "job-1",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 1500,
      output_tokens: 850,
      estimated_cost: 0.0367,
      credits_used: 5,
    });
  });

  it("defaults provider to anthropic and missing optional fields to null", async () => {
    const client = makeClient({
      usage_events: { data: null, error: null },
    });

    await logUsageEvent({
      userId: "u1",
      model: "claude-haiku-4-5",
      client: client as never,
    });

    expect(client.__chains.usage_events!.insert).toHaveBeenCalledWith({
      user_id: "u1",
      blog_id: null,
      article_id: null,
      article_idea_id: null,
      job_id: null,
      provider: "anthropic",
      model: "claude-haiku-4-5",
      input_tokens: null,
      output_tokens: null,
      estimated_cost: null,
      credits_used: null,
    });
  });

  it("propagates supabase insert errors", async () => {
    const client = makeClient({
      usage_events: { data: null, error: { message: "boom" } },
    });
    // Make insert resolve with the error (the helper doesn't .select() after insert).
    client.__chains.usage_events!.insert = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(
      logUsageEvent({
        userId: "u1",
        model: "claude-haiku-4-5",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "boom" });
  });

  it("uses the admin client when none is injected", async () => {
    const client = makeClient({
      usage_events: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await logUsageEvent({ userId: "u1", model: "m" });

    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// getBlogGenerationContext
// ============================================================================

describe("getBlogGenerationContext", () => {
  const blogRow = {
    id: "b1",
    name: "Acme",
    description: "A workflow blog",
    slug: "acme",
    project_id: "p1",
    settings: { identity: { audience: "engineers" } },
  };
  const projectRow = { id: "p1", name: "Default", team_id: "t1" };
  const teamRow = { id: "t1", name: "Acme team" };

  it("resolves blog + project + team and normalizes settings", async () => {
    const client = makeClient({
      blogs: { data: blogRow, error: null },
      projects: { data: projectRow, error: null },
      teams: { data: teamRow, error: null },
    });

    const ctx = await getBlogGenerationContext("b1", client as never);

    expect(ctx).not.toBeNull();
    expect(ctx!.blog).toEqual({
      id: "b1",
      name: "Acme",
      description: "A workflow blog",
      slug: "acme",
      projectId: "p1",
    });
    expect(ctx!.project).toEqual({
      id: "p1",
      name: "Default",
      teamId: "t1",
    });
    expect(ctx!.team).toEqual({ id: "t1", name: "Acme team" });
    // loadBlogSettings normalizes; partial input flows through.
    expect(ctx!.settings.identity.audience).toBe("engineers");
    // Unset fields fall back to defaults.
    expect(ctx!.settings.automation.mode).toBe("manual");
  });

  it("returns null when the blog is missing", async () => {
    const client = makeClient({
      blogs: { data: null, error: null },
    });

    const ctx = await getBlogGenerationContext("missing", client as never);
    expect(ctx).toBeNull();
  });

  it("returns null when the project is missing (orphaned blog)", async () => {
    const client = makeClient({
      blogs: { data: blogRow, error: null },
      projects: { data: null, error: null },
    });

    const ctx = await getBlogGenerationContext("b1", client as never);
    expect(ctx).toBeNull();
  });

  it("returns null when the team is missing (orphaned project)", async () => {
    const client = makeClient({
      blogs: { data: blogRow, error: null },
      projects: { data: projectRow, error: null },
      teams: { data: null, error: null },
    });

    const ctx = await getBlogGenerationContext("b1", client as never);
    expect(ctx).toBeNull();
  });

  it("propagates supabase errors from each step", async () => {
    const blogErr = makeClient({
      blogs: { data: null, error: { message: "blog boom" } },
    });
    await expect(
      getBlogGenerationContext("b1", blogErr as never),
    ).rejects.toEqual({ message: "blog boom" });

    const projErr = makeClient({
      blogs: { data: blogRow, error: null },
      projects: { data: null, error: { message: "project boom" } },
    });
    await expect(
      getBlogGenerationContext("b1", projErr as never),
    ).rejects.toEqual({ message: "project boom" });

    const teamErr = makeClient({
      blogs: { data: blogRow, error: null },
      projects: { data: projectRow, error: null },
      teams: { data: null, error: { message: "team boom" } },
    });
    await expect(
      getBlogGenerationContext("b1", teamErr as never),
    ).rejects.toEqual({ message: "team boom" });
  });

  it("uses the admin client when none is injected", async () => {
    const client = makeClient({
      blogs: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await getBlogGenerationContext("b1");

    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// listArticleIdeasForBlog
// ============================================================================

describe("listArticleIdeasForBlog", () => {
  it("returns article ideas ordered by created_at desc", async () => {
    const rows = [
      { id: "i1", title: "Idea 1" },
      { id: "i2", title: "Idea 2" },
    ];
    const client = makeClient({
      article_ideas: { data: rows, error: null },
    });
    // listArticleIdeasForBlog awaits the chain after .order(); make .order resolve.
    client.__chains.article_ideas!.order = vi
      .fn()
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await listArticleIdeasForBlog("b1", client as never);
    expect(result).toEqual(rows);
    expect(client.__chains.article_ideas!.order).toHaveBeenCalledWith(
      "created_at",
      { ascending: false },
    );
  });

  it("returns [] when supabase returns null data", async () => {
    const client = makeClient({
      article_ideas: { data: null, error: null },
    });
    client.__chains.article_ideas!.order = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null });

    const result = await listArticleIdeasForBlog("b1", client as never);
    expect(result).toEqual([]);
  });

  it("propagates supabase errors", async () => {
    const client = makeClient({
      article_ideas: { data: null, error: null },
    });
    client.__chains.article_ideas!.order = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(
      listArticleIdeasForBlog("b1", client as never),
    ).rejects.toEqual({ message: "boom" });
  });

  it("uses the admin client when none is injected", async () => {
    const client = makeClient({
      article_ideas: { data: [], error: null },
    });
    client.__chains.article_ideas!.order = vi
      .fn()
      .mockResolvedValueOnce({ data: [], error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    await listArticleIdeasForBlog("b1");

    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// convertIdeaToArticle
// ============================================================================

describe("convertIdeaToArticle", () => {
  it("links the article to the idea then flips the idea status", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
      article_ideas: { data: null, error: null },
    });

    await convertIdeaToArticle({
      ideaId: "idea-1",
      articleId: "article-1",
      client: client as never,
    });

    expect(client.__chains.articles!.update).toHaveBeenCalledWith({
      article_idea_id: "idea-1",
    });
    expect(client.__chains.articles!.eq).toHaveBeenCalledWith(
      "id",
      "article-1",
    );
    expect(client.__chains.article_ideas!.update).toHaveBeenCalledWith({
      status: "converted_to_article",
    });
    expect(client.__chains.article_ideas!.eq).toHaveBeenCalledWith(
      "id",
      "idea-1",
    );
  });

  it("propagates an error from the article update without touching the idea", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
      article_ideas: { data: null, error: null },
    });
    client.__chains.articles!.eq = vi.fn().mockResolvedValueOnce({
      data: null,
      error: { message: "article boom" },
    });

    await expect(
      convertIdeaToArticle({
        ideaId: "idea-1",
        articleId: "article-1",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "article boom" });

    expect(client.__chains.article_ideas!.update).not.toHaveBeenCalled();
  });

  it("propagates an error from the idea status flip", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
      article_ideas: { data: null, error: null },
    });
    client.__chains.article_ideas!.eq = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "idea boom" } });

    await expect(
      convertIdeaToArticle({
        ideaId: "idea-1",
        articleId: "article-1",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "idea boom" });
  });

  it("uses the admin client when none is injected", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
      article_ideas: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await convertIdeaToArticle({ ideaId: "i1", articleId: "a1" });

    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// generateArticleIdeas (the canonical orchestration)
// ============================================================================

const blogRow = {
  id: "b1",
  name: "Acme",
  description: "A workflow blog",
  slug: "acme",
  project_id: "p1",
  settings: { identity: { audience: "engineers" } },
};
const projectRow = { id: "p1", name: "Default", team_id: "t1" };
const teamRow = { id: "t1", name: "Acme team" };

const aiBatchStub = {
  ideas: [
    {
      title: "Idea A",
      slug: "idea-a",
      targetKeyword: "kw-a",
      executiveSummary: "A summary that exceeds twenty characters easily.",
      articleType: "how_to",
      estimatedWordCount: 1200,
    },
    {
      title: "Idea B",
      slug: "idea-b",
      targetKeyword: "kw-b",
      executiveSummary: "Another summary that exceeds twenty characters.",
      articleType: "listicle",
      estimatedWordCount: 800,
    },
  ],
  model: "claude-haiku-4-5",
  promptTokens: 800,
  completionTokens: 600,
  cachedReadTokens: 0,
  cachedWriteTokens: 0,
};

/**
 * Wires up a single mock client whose tables behave correctly for the
 * full orchestration: blog/project/team for context resolution,
 * article_jobs for create + status updates, article_ideas for the
 * batch insert, usage_events for the audit row.
 */
function makeOrchestrationClient(opts?: {
  insertedIdeas?: Array<{ id: string; title: string }>;
  insertIdeasError?: { message: string };
}): MockClient {
  const insertedIdeas = opts?.insertedIdeas ?? [
    { id: "idea-A", title: "Idea A" },
    { id: "idea-B", title: "Idea B" },
  ];
  const client = makeClient({
    blogs: { data: blogRow, error: null },
    projects: { data: projectRow, error: null },
    teams: { data: teamRow, error: null },
    article_jobs: { data: { id: "job-X", attempts: 0 }, error: null },
    article_ideas: { data: insertedIdeas, error: null },
    usage_events: { data: null, error: null },
  });

  // article_ideas: the orchestration calls .insert(...).select("*"); make
  // .select resolve to the inserted rows (or an error).
  client.__chains.article_ideas!.select = vi
    .fn()
    .mockResolvedValue(
      opts?.insertIdeasError
        ? { data: null, error: opts.insertIdeasError }
        : { data: insertedIdeas, error: null },
    );

  return client;
}

describe("generateArticleIdeas", () => {
  beforeEach(() => {
    mockedGenerateIdeas.mockResolvedValue(aiBatchStub as never);
    mockedConsumeTeamTokens.mockResolvedValue(95);
  });

  it("runs the happy path end-to-end and returns the inserted ideas", async () => {
    const client = makeOrchestrationClient();

    const result = await generateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      brief: "  durable AI workflows  ",
      triggerSource: "manual",
      client: client as never,
    });

    expect(result.jobId).toBe("job-X");
    expect(result.ideas).toHaveLength(2);
    expect(result.creditsUsed).toBe(1); // AI_CREDIT_COSTS.generateIdeas
    expect(result.model).toBe("claude-haiku-4-5");
    expect(result.promptTokens).toBe(800);
    expect(result.completionTokens).toBe(600);
  });

  it("calls the AI provider with the resolved blog context + brief", async () => {
    const client = makeOrchestrationClient();

    await generateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      brief: "How to ship faster",
      triggerSource: "manual",
      client: client as never,
    });

    expect(mockedGenerateIdeas).toHaveBeenCalledWith(
      expect.objectContaining({
        blogName: "Acme",
        blogDescription: "A workflow blog",
        brief: "How to ship faster",
        count: 10,
      }),
    );
  });

  it("passes blogDescription as undefined when the blog row has none", async () => {
    const client = makeOrchestrationClient();
    // Override the blogs chain to return an empty description.
    client.__chains.blogs!.maybeSingle = vi.fn().mockResolvedValue({
      data: { ...blogRow, description: "" },
      error: null,
    });

    await generateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      triggerSource: "manual",
      client: client as never,
    });

    const call = mockedGenerateIdeas.mock.calls[0]![0] as {
      blogDescription?: string;
    };
    expect(call.blogDescription).toBeUndefined();
  });

  it("snapshots blog settings + trigger metadata into article_jobs.input", async () => {
    const client = makeOrchestrationClient();

    await generateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      triggerSource: "autopilot",
      jobMetadata: {
        scheduledRunId: "run-42",
        scheduleId: "sched-1",
      },
      client: client as never,
    });

    const insertArg = client.__chains.article_jobs!.insert.mock
      .calls[0]![0] as {
      input: Record<string, unknown>;
    };
    expect(insertArg.input).toMatchObject({
      triggerSource: "autopilot",
      brief: null,
      count: 10,
      teamId: "t1",
      scheduledRunId: "run-42",
      scheduleId: "sched-1",
    });
    expect(insertArg.input.blogSettingsSnapshot).toBeDefined();
  });

  it("normalizes a blank brief to null in the job metadata", async () => {
    const client = makeOrchestrationClient();

    await generateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      brief: "   \n  ",
      triggerSource: "manual",
      client: client as never,
    });

    const insertArg = client.__chains.article_jobs!.insert.mock
      .calls[0]![0] as {
      input: Record<string, unknown>;
    };
    expect(insertArg.input.brief).toBeNull();
  });

  it("respects a custom count and threads it into both job + AI prompt", async () => {
    const client = makeOrchestrationClient();

    await generateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      count: 5,
      triggerSource: "manual",
      client: client as never,
    });

    expect(mockedGenerateIdeas).toHaveBeenCalledWith(
      expect.objectContaining({ count: 5 }),
    );
    const insertArg = client.__chains.article_jobs!.insert.mock
      .calls[0]![0] as {
      input: { count: number };
    };
    expect(insertArg.input.count).toBe(5);
  });

  it("uses the job id as the consume_team_tokens idempotency key", async () => {
    const client = makeOrchestrationClient();

    await generateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      triggerSource: "manual",
      client: client as never,
    });

    expect(mockedConsumeTeamTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "t1",
        amount: 1,
        actingUserId: "u1",
        idempotencyKey: "article_job::job-X",
        metadata: expect.objectContaining({
          blog_id: "b1",
          job_id: "job-X",
          trigger_source: "manual",
          job_type: "generate_ideas",
        }),
      }),
    );
  });

  it("throws blog_not_found when the blog is missing", async () => {
    const client = makeClient({
      blogs: { data: null, error: null },
      article_jobs: { data: null, error: null },
    });

    await expect(
      generateArticleIdeas({
        blogId: "missing",
        teamId: "t1",
        userId: "u1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toThrow(/blog_not_found/);

    // No job should have been created.
    expect(client.__chains.article_jobs?.insert).not.toHaveBeenCalled();
  });

  it("marks the job failed and rethrows when consume_team_tokens fails", async () => {
    const client = makeOrchestrationClient();
    mockedConsumeTeamTokens.mockRejectedValueOnce(
      new Error("insufficient_tokens"),
    );

    await expect(
      generateArticleIdeas({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toThrow(/insufficient_tokens/);

    // The orchestration should have called update with status: 'failed'.
    const updateCalls = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0],
    );
    expect(updateCalls.some((u) => u.status === "failed")).toBe(true);
    // AI provider must NOT have been called.
    expect(mockedGenerateIdeas).not.toHaveBeenCalled();
  });

  it("marks the job failed AND refunds when the AI provider throws (v1.1 behavior)", async () => {
    const client = makeOrchestrationClient();
    mockedGenerateIdeas.mockRejectedValueOnce(new Error("schema mismatch"));
    mockedRefundTeamTokens.mockResolvedValueOnce(100);

    await expect(
      generateArticleIdeas({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toThrow(/schema mismatch/);

    expect(mockedConsumeTeamTokens).toHaveBeenCalledOnce();
    // v1.1: a refund is issued so the autopilot scheduler doesn't
    // double-charge a team whose backlog top-up keeps retrying.
    expect(mockedRefundTeamTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "t1",
        amount: 1,
        idempotencyKey: "refund::article_job::job-X",
        metadata: expect.objectContaining({
          refunded_for_job_id: "job-X",
          refunded_for_job_type: "generate_ideas",
        }),
      }),
    );

    const updateCalls = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0],
    );
    expect(updateCalls.some((u) => u.status === "failed")).toBe(true);
  });

  it("marks the job failed when the article_ideas insert fails", async () => {
    const client = makeOrchestrationClient({
      insertIdeasError: { message: "constraint violation" },
    });

    await expect(
      generateArticleIdeas({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "constraint violation" });

    const updateCalls = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0],
    );
    expect(updateCalls.some((u) => u.status === "failed")).toBe(true);
  });

  it("logs a usage_events row with provider, model, and token counts", async () => {
    const client = makeOrchestrationClient();

    await generateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      triggerSource: "manual",
      client: client as never,
    });

    expect(client.__chains.usage_events!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        blog_id: "b1",
        job_id: "job-X",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        input_tokens: 800,
        output_tokens: 600,
        credits_used: 1,
      }),
    );
  });

  it("marks the job completed with a structured output payload", async () => {
    const client = makeOrchestrationClient();

    await generateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      triggerSource: "manual",
      client: client as never,
    });

    const updateCalls = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0],
    );
    const completed = updateCalls.find((u) => u.status === "completed");
    expect(completed).toBeDefined();
    expect(completed!.current_step).toBe("completed");
    expect(completed!.output).toMatchObject({
      model: "claude-haiku-4-5",
      promptTokens: 800,
      completionTokens: 600,
      ideasGenerated: 2,
      creditsUsed: 1,
    });
  });

  it("uses the admin client when none is injected", async () => {
    const client = makeOrchestrationClient();
    mockedCreateAdmin.mockReturnValue(client as never);

    await generateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      triggerSource: "manual",
    });

    expect(mockedCreateAdmin).toHaveBeenCalled();
  });

  it("propagates non-Error throws as their string form", async () => {
    const client = makeOrchestrationClient();
    mockedConsumeTeamTokens.mockRejectedValueOnce("plain-string-failure");

    await expect(
      generateArticleIdeas({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toBe("plain-string-failure");

    const failedCall = client.__chains.article_jobs!.update.mock.calls.find(
      (c) => (c[0] as { status?: string }).status === "failed",
    );
    expect(failedCall).toBeDefined();
    expect((failedCall![0] as { error_message: string }).error_message).toBe(
      "plain-string-failure",
    );
  });
});

// ============================================================================
// queueGenerateArticleIdeas — durable enqueue (no token consumption)
// ============================================================================

describe("queueGenerateArticleIdeas", () => {
  it("creates a generate_ideas job row and returns ids without consuming tokens", async () => {
    const client = makeOrchestrationClient();

    const result = await queueGenerateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      brief: "  durable AI workflows  ",
      triggerSource: "manual",
      client: client as never,
    });

    expect(result).toMatchObject({
      jobId: "job-X",
      blogId: "b1",
      count: 10,
      status: "pending",
      alreadyQueued: false,
    });
    expect(mockedConsumeTeamTokens).not.toHaveBeenCalled();
    expect(mockedGenerateIdeas).not.toHaveBeenCalled();
    // Job row has the snapshot input.
    expect(client.__chains.article_jobs!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "generate_ideas",
        input: expect.objectContaining({
          triggerSource: "manual",
          brief: "durable AI workflows",
          count: 10,
          teamId: "t1",
          blogSettingsSnapshot: expect.any(Object),
        }),
      }),
    );
  });

  it("respects a custom count and merges jobMetadata into the snapshot", async () => {
    const client = makeOrchestrationClient();

    await queueGenerateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      count: 4,
      triggerSource: "manual",
      jobMetadata: { source: "modal" },
      client: client as never,
    });

    const insertArg = client.__chains.article_jobs!.insert.mock
      .calls[0]![0] as { input: Record<string, unknown> };
    expect(insertArg.input).toMatchObject({ count: 4, source: "modal" });
  });

  it("returns the existing job when one is already pending/processing for the blog", async () => {
    const client = makeOrchestrationClient();
    // Make the idempotency check (the article_jobs `then` resolver)
    // yield an existing in-flight row.
    client.__chains.article_jobs!.then = ((
      onFulfilled?: ((v: unknown) => unknown) | null,
      onRejected?: ((r: unknown) => unknown) | null,
    ) =>
      Promise.resolve({
        data: [{ id: "job-existing", status: "processing" }],
        error: null,
      }).then(
        onFulfilled,
        onRejected,
      )) as typeof client.__chains.article_jobs.then;

    const result = await queueGenerateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      triggerSource: "manual",
      client: client as never,
    });

    expect(result).toEqual({
      jobId: "job-existing",
      blogId: "b1",
      count: 10,
      status: "processing",
      alreadyQueued: true,
    });
    // No new job — idempotency short-circuited the insert.
    expect(client.__chains.article_jobs!.insert).not.toHaveBeenCalled();
  });

  it("propagates the idempotency-check supabase error", async () => {
    const client = makeOrchestrationClient();
    client.__chains.article_jobs!.then = ((
      onFulfilled?: ((v: unknown) => unknown) | null,
      onRejected?: ((r: unknown) => unknown) | null,
    ) =>
      Promise.resolve({
        data: null,
        error: { message: "active jobs query boom" },
      }).then(
        onFulfilled,
        onRejected,
      )) as typeof client.__chains.article_jobs.then;

    await expect(
      queueGenerateArticleIdeas({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "active jobs query boom" });
  });

  it("throws blog_not_found when the blog is missing", async () => {
    const client = makeClient({
      blogs: { data: null, error: null },
      article_jobs: { data: null, error: null },
    });

    await expect(
      queueGenerateArticleIdeas({
        blogId: "missing",
        teamId: "t1",
        userId: "u1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toThrow(/blog_not_found/);

    expect(client.__chains.article_jobs?.insert).not.toHaveBeenCalled();
  });

  it("normalizes a blank brief to null", async () => {
    const client = makeOrchestrationClient();

    await queueGenerateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      brief: "   \n   ",
      triggerSource: "manual",
      client: client as never,
    });

    const insertArg = client.__chains.article_jobs!.insert.mock
      .calls[0]![0] as { input: Record<string, unknown> };
    expect(insertArg.input.brief).toBeNull();
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makeOrchestrationClient();
    mockedCreateAdmin.mockReturnValue(client as never);

    await queueGenerateArticleIdeas({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      triggerSource: "manual",
    });

    expect(mockedCreateAdmin).toHaveBeenCalled();
  });
});

// ============================================================================
// runGenerateArticleIdeasJob — workflow step body
// ============================================================================

describe("runGenerateArticleIdeasJob", () => {
  beforeEach(() => {
    mockedGenerateIdeas.mockResolvedValue(aiBatchStub as never);
    mockedConsumeTeamTokens.mockResolvedValue(95);
    mockedRefundTeamTokens.mockResolvedValue(100);
  });

  it("executes the full pipeline against a pre-existing job id", async () => {
    const client = makeOrchestrationClient();

    const result = await runGenerateArticleIdeasJob({
      jobId: "job-existing",
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      brief: "durable workflows",
      count: 6,
      triggerSource: "workflow",
      client: client as never,
    });

    expect(result.jobId).toBe("job-existing");
    expect(result.ideas).toHaveLength(2);
    expect(mockedConsumeTeamTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "article_job::job-existing",
        metadata: expect.objectContaining({
          job_type: "generate_ideas",
          trigger_source: "workflow",
        }),
      }),
    );
    expect(mockedGenerateIdeas).toHaveBeenCalledWith(
      expect.objectContaining({
        brief: "durable workflows",
        count: 6,
      }),
    );
  });

  it("merges jobInputPatch (workflowRunId/autopilotRunId) into article_jobs.input", async () => {
    const client = makeOrchestrationClient();
    // The orchestration calls maybeSingle on article_jobs twice:
    //   1) inside `mergeArticleJobInput` (reads `input` jsonb)
    //   2) inside `updateArticleJobStatus` when incrementing attempts
    // Wire both resolves explicitly so neither returns undefined.
    client.__chains.article_jobs!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: { input: { triggerSource: "workflow" } },
        error: null,
      })
      .mockResolvedValueOnce({ data: { attempts: 0 }, error: null });

    await runGenerateArticleIdeasJob({
      jobId: "job-X",
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      jobInputPatch: { workflowRunId: "run-1", workflowName: "test" },
      client: client as never,
    });

    const updateCalls = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0] as Record<string, unknown>,
    );
    const merged = updateCalls.find(
      (u) =>
        (u.input as Record<string, unknown> | undefined)?.workflowRunId ===
        "run-1",
    );
    expect(merged).toBeDefined();
  });

  it("refunds tokens when the AI provider throws after a successful consume", async () => {
    const client = makeOrchestrationClient();
    mockedGenerateIdeas.mockRejectedValueOnce(new Error("schema mismatch"));

    await expect(
      runGenerateArticleIdeasJob({
        jobId: "job-X",
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        triggerSource: "workflow",
        client: client as never,
      }),
    ).rejects.toThrow(/schema mismatch/);

    expect(mockedConsumeTeamTokens).toHaveBeenCalledOnce();
    expect(mockedRefundTeamTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "t1",
        amount: 1,
        idempotencyKey: "refund::article_job::job-X",
        metadata: expect.objectContaining({
          refunded_for_job_id: "job-X",
          refunded_for_job_type: "generate_ideas",
        }),
      }),
    );
  });

  it("does NOT refund when consume itself fails (nothing was charged)", async () => {
    const client = makeOrchestrationClient();
    mockedConsumeTeamTokens.mockRejectedValueOnce(
      new Error("insufficient_tokens"),
    );

    await expect(
      runGenerateArticleIdeasJob({
        jobId: "job-X",
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        triggerSource: "workflow",
        client: client as never,
      }),
    ).rejects.toThrow(/insufficient_tokens/);

    expect(mockedRefundTeamTokens).not.toHaveBeenCalled();
    expect(mockedGenerateIdeas).not.toHaveBeenCalled();
  });

  it("refunds when the article_ideas insert fails after a successful AI call", async () => {
    const client = makeOrchestrationClient({
      insertIdeasError: { message: "constraint violation" },
    });

    await expect(
      runGenerateArticleIdeasJob({
        jobId: "job-X",
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        triggerSource: "workflow",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "constraint violation" });

    expect(mockedRefundTeamTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "refund::article_job::job-X",
      }),
    );
  });

  it("throws blog_not_found and skips token consumption when the blog vanishes", async () => {
    const client = makeClient({
      blogs: { data: null, error: null },
      article_jobs: { data: { id: "job-X" }, error: null },
    });

    await expect(
      runGenerateArticleIdeasJob({
        jobId: "job-X",
        blogId: "missing",
        teamId: "t1",
        userId: "u1",
        triggerSource: "workflow",
        client: client as never,
      }),
    ).rejects.toThrow(/blog_not_found/);

    expect(mockedConsumeTeamTokens).not.toHaveBeenCalled();
    expect(mockedRefundTeamTokens).not.toHaveBeenCalled();
  });

  it("defaults triggerSource to 'workflow' on the consume metadata", async () => {
    const client = makeOrchestrationClient();

    await runGenerateArticleIdeasJob({
      jobId: "job-X",
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      // no triggerSource passed
      client: client as never,
    });

    const consumeArg = mockedConsumeTeamTokens.mock.calls[0]![0] as {
      metadata: Record<string, unknown>;
    };
    expect(consumeArg.metadata.trigger_source).toBe("workflow");
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makeOrchestrationClient();
    mockedCreateAdmin.mockReturnValue(client as never);

    await runGenerateArticleIdeasJob({
      jobId: "job-X",
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      triggerSource: "workflow",
    });

    expect(mockedCreateAdmin).toHaveBeenCalled();
  });
});

// ============================================================================
// IDEA_STATUS_TRANSITIONS + isAllowedIdeaStatusTransition
// ============================================================================

describe("IDEA_STATUS_TRANSITIONS", () => {
  it("forbids regression to generated from any status", () => {
    for (const from of ARTICLE_IDEA_STATUSES) {
      expect(IDEA_STATUS_TRANSITIONS[from]).not.toContain("generated");
    }
  });

  it("treats converted_to_article as terminal", () => {
    expect(IDEA_STATUS_TRANSITIONS.converted_to_article).toEqual([]);
  });

  it("never allows converted_to_article as a manual destination", () => {
    for (const from of ARTICLE_IDEA_STATUSES) {
      expect(IDEA_STATUS_TRANSITIONS[from]).not.toContain(
        "converted_to_article",
      );
    }
  });

  it("allows generated → approved/rejected and approved ↔ rejected", () => {
    expect([...IDEA_STATUS_TRANSITIONS.generated]).toEqual([
      "approved",
      "rejected",
    ]);
    expect([...IDEA_STATUS_TRANSITIONS.approved]).toEqual(["rejected"]);
    expect([...IDEA_STATUS_TRANSITIONS.rejected]).toEqual(["approved"]);
  });
});

describe("isAllowedIdeaStatusTransition", () => {
  const cases: Array<{
    from: (typeof ARTICLE_IDEA_STATUSES)[number];
    to: (typeof ARTICLE_IDEA_STATUSES)[number];
    allowed: boolean;
  }> = [
    { from: "generated", to: "approved", allowed: true },
    { from: "generated", to: "rejected", allowed: true },
    { from: "generated", to: "converted_to_article", allowed: false },
    { from: "approved", to: "rejected", allowed: true },
    { from: "approved", to: "generated", allowed: false },
    { from: "approved", to: "converted_to_article", allowed: false },
    { from: "rejected", to: "approved", allowed: true },
    { from: "rejected", to: "generated", allowed: false },
    { from: "rejected", to: "converted_to_article", allowed: false },
    { from: "converted_to_article", to: "approved", allowed: false },
    { from: "converted_to_article", to: "rejected", allowed: false },
    { from: "converted_to_article", to: "generated", allowed: false },
  ];

  it.each(cases)("$from → $to ⇒ $allowed", ({ from, to, allowed }) => {
    expect(isAllowedIdeaStatusTransition(from, to)).toBe(allowed);
  });
});

// ============================================================================
// updateArticleIdeaStatus
// ============================================================================

describe("updateArticleIdeaStatus", () => {
  it("reads the existing row, validates the transition, and writes the new status", async () => {
    const client = makeClient({
      article_ideas: {
        data: { id: "i1", blog_id: "b1", status: "generated" },
        error: null,
      },
    });
    // Two terminal calls happen on the article_ideas chain:
    //   1) .select("*").eq().eq().maybeSingle() — the read
    //   2) .update().eq().eq().select("*").single() — the write
    // The default `single` mock returns the read data; we override it
    // for the update so the helper sees the new row.
    client.__chains.article_ideas!.single = vi.fn().mockResolvedValueOnce({
      data: {
        id: "i1",
        blog_id: "b1",
        status: "approved",
        title: "X",
      },
      error: null,
    });

    const result = await updateArticleIdeaStatus({
      ideaId: "i1",
      blogId: "b1",
      status: "approved",
      client: client as never,
    });

    expect(result.status).toBe("approved");
    expect(client.__chains.article_ideas!.update).toHaveBeenCalledWith({
      status: "approved",
    });
    expect(client.__chains.article_ideas!.eq).toHaveBeenCalledWith("id", "i1");
    expect(client.__chains.article_ideas!.eq).toHaveBeenCalledWith(
      "blog_id",
      "b1",
    );
  });

  it("is a no-op when the requested status equals the current one", async () => {
    const existing = {
      id: "i1",
      blog_id: "b1",
      status: "approved",
      title: "X",
    };
    const client = makeClient({
      article_ideas: { data: existing, error: null },
    });

    const result = await updateArticleIdeaStatus({
      ideaId: "i1",
      blogId: "b1",
      status: "approved",
      client: client as never,
    });

    expect(result).toEqual(existing);
    expect(client.__chains.article_ideas!.update).not.toHaveBeenCalled();
  });

  it("throws idea_not_found when no matching row exists", async () => {
    const client = makeClient({
      article_ideas: { data: null, error: null },
    });

    await expect(
      updateArticleIdeaStatus({
        ideaId: "missing",
        blogId: "b1",
        status: "approved",
        client: client as never,
      }),
    ).rejects.toThrow("idea_not_found");
  });

  it("rejects forbidden transitions with a typed message", async () => {
    const client = makeClient({
      article_ideas: {
        data: {
          id: "i1",
          blog_id: "b1",
          status: "converted_to_article",
        },
        error: null,
      },
    });

    await expect(
      updateArticleIdeaStatus({
        ideaId: "i1",
        blogId: "b1",
        status: "approved",
        client: client as never,
      }),
    ).rejects.toThrow(
      "invalid_idea_status_transition:converted_to_article->approved",
    );

    expect(client.__chains.article_ideas!.update).not.toHaveBeenCalled();
  });

  it("propagates supabase read errors", async () => {
    const client = makeClient({
      article_ideas: { data: null, error: { message: "read boom" } },
    });

    await expect(
      updateArticleIdeaStatus({
        ideaId: "i1",
        blogId: "b1",
        status: "approved",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "read boom" });
  });

  it("propagates supabase update errors", async () => {
    const client = makeClient({
      article_ideas: {
        data: { id: "i1", blog_id: "b1", status: "generated" },
        error: null,
      },
    });
    client.__chains.article_ideas!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "write boom" } });

    await expect(
      updateArticleIdeaStatus({
        ideaId: "i1",
        blogId: "b1",
        status: "approved",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "write boom" });
  });

  it("uses the admin client when none is injected", async () => {
    const client = makeClient({
      article_ideas: {
        data: { id: "i1", blog_id: "b1", status: "approved" },
        error: null,
      },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await updateArticleIdeaStatus({
      ideaId: "i1",
      blogId: "b1",
      status: "approved",
    });

    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// buildBriefFromIdea
// ============================================================================

describe("buildBriefFromIdea", () => {
  const baseIdea = {
    title: "How to launch a B2B blog",
    target_keyword: "launch b2b blog",
    executive_summary: "A 30-day playbook for shipping the first ten posts.",
    article_type: "how_to",
    estimated_word_count: 1500,
  };

  it("includes the title, keyword, summary, type, and length when present", () => {
    const brief = buildBriefFromIdea(baseIdea);
    expect(brief).toContain("How to launch a B2B blog");
    expect(brief).toContain("launch b2b blog");
    expect(brief).toContain("30-day playbook");
    expect(brief).toContain("how_to");
    expect(brief).toContain("1500");
    expect(brief).toContain("Stay close to the title");
  });

  it("omits optional fields cleanly when they are null", () => {
    const brief = buildBriefFromIdea({
      ...baseIdea,
      target_keyword: null,
      executive_summary: null,
      article_type: null,
      estimated_word_count: null,
    });
    expect(brief).toContain("How to launch a B2B blog");
    expect(brief).not.toContain("Target keyword");
    expect(brief).not.toContain("Executive summary");
    expect(brief).not.toContain("Article format");
    expect(brief).not.toContain("Approximate length");
  });
});

// ============================================================================
// generateArticleDraftFromIdea
// ============================================================================

const draftStub = {
  title: "How to launch a B2B blog in 30 days, step by step",
  slug: "how-to-launch-a-b2b-blog-in-30-days-step-by-step",
  excerpt: "A 30-day plan to ship your first ten posts without burnout.",
  metaDescription:
    "Practical 30-day playbook for launching a B2B blog: positioning, research, writing, publishing.",
  contentMarkdown:
    "# How to launch a B2B blog in 30 days\n\n" +
    "Launching a B2B blog is mostly about discipline. Here's the plan...\n\n" +
    "## Week 1: positioning\n\nClarify the audience...",
  targetKeyword: "launch a b2b blog",
  wordCount: 1623,
  outline: [
    { heading: "Week 1: positioning", summary: "Clarify audience + voice." },
    { heading: "Week 2: research", summary: "Topic + keyword map." },
  ],
  model: "claude-sonnet-4-6",
  promptTokens: 2200,
  completionTokens: 1800,
  cachedReadTokens: 0,
  cachedWriteTokens: 0,
};

const ideaRowStub = {
  id: "idea-1",
  blog_id: "b1",
  status: "approved",
  title: "How to launch a B2B blog in 30 days",
  slug: null,
  target_keyword: "launch b2b blog",
  executive_summary: "A practical 30-day plan to ship the first ten posts.",
  article_type: "how_to",
  estimated_word_count: 1500,
  raw_ai_response: null,
  user_id: "u1",
  created_at: "2026-05-07T10:00:00Z",
  updated_at: "2026-05-07T10:00:00Z",
};

/**
 * Wires up a single mock client whose tables behave correctly for the
 * full generateArticleDraftFromIdea orchestration.
 */
function makeArticleOrchestrationClient(opts?: {
  ideaStatus?: string;
  insertArticleError?: { message: string };
  updateArticleError?: { message: string };
  ideaMissing?: boolean;
}): MockClient {
  const blogRow = {
    id: "b1",
    name: "Acme",
    description: "A workflow blog",
    slug: "acme",
    project_id: "p1",
    settings: { identity: { audience: "engineers" } },
  };
  const projectRow = { id: "p1", name: "Default", team_id: "t1" };
  const teamRow = { id: "t1", name: "Acme team" };
  const idea = opts?.ideaMissing
    ? null
    : {
        ...ideaRowStub,
        status: opts?.ideaStatus ?? "approved",
      };

  const client = makeClient({
    blogs: { data: blogRow, error: null },
    projects: { data: projectRow, error: null },
    teams: { data: teamRow, error: null },
    article_ideas: { data: idea, error: null },
    article_jobs: { data: { id: "job-X", attempts: 0 }, error: null },
    articles: { data: { id: "article-X" }, error: null },
    usage_events: { data: null, error: null },
  });

  // articles: insert(...).select("id").single() — first single resolves the
  // placeholder insert; second .eq resolves the post-AI update; eq calls in
  // between handle the job.article_id link.
  client.__chains.articles!.single = vi
    .fn()
    .mockResolvedValueOnce(
      opts?.insertArticleError
        ? { data: null, error: opts.insertArticleError }
        : { data: { id: "article-X" }, error: null },
    );
  // The post-AI update chain ends with .eq() — we need to control that
  // resolved value too. Default it to success unless overridden.
  client.__chains.articles!.eq = vi.fn(function (this: {
    __chain: typeof client.__chains.articles;
  }) {
    return client.__chains.articles!;
  }) as never;
  // The articles update().eq() resolves at the .eq() terminal. Replace
  // it with a mock that accepts the chained calls and resolves on the
  // 2nd call (the update after AI). For simplicity we leave .eq
  // returning the chain (mockReturnThis) and rely on update being a
  // thenable via the chain's update mock — but supabase actually
  // resolves on the .eq() that terminates the update. To keep the
  // mocks clean we replace .eq for articles with a counter-based mock.
  let articlesEqCallCount = 0;
  client.__chains.articles!.eq = vi.fn(() => {
    articlesEqCallCount += 1;
    // First .eq follows insert(...).select(...).single() which already
    // returned. Second .eq is the post-AI update terminal.
    if (articlesEqCallCount === 1) {
      return Promise.resolve(
        opts?.updateArticleError
          ? { data: null, error: opts.updateArticleError }
          : { data: null, error: null },
      ) as never;
    }
    // Subsequent .eq calls (failArticleAndJob path) — always succeed.
    return Promise.resolve({ data: null, error: null }) as never;
  }) as never;

  return client;
}

describe("generateArticleDraftFromIdea", () => {
  beforeEach(() => {
    mockedGenerateArticleDraft.mockResolvedValue(draftStub as never);
    mockedConsumeTeamTokens.mockResolvedValue(95);
    // Default refund returns the new balance after the credit goes back.
    mockedRefundTeamTokens.mockResolvedValue(100);
  });

  it("runs the happy path end-to-end and returns the new article id", async () => {
    const client = makeArticleOrchestrationClient();

    const result = await generateArticleDraftFromIdea({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "manual",
      client: client as never,
    });

    expect(result.jobId).toBe("job-X");
    expect(result.articleId).toBe("article-X");
    expect(result.ideaId).toBe("idea-1");
    expect(result.status).toBe("ready_for_review");
    expect(result.creditsUsed).toBe(5); // AI_CREDIT_COSTS.generateArticle
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.promptTokens).toBe(2200);
    expect(result.completionTokens).toBe(1800);
  });

  it("creates the job with type=generate_article + idea snapshot in input", async () => {
    const client = makeArticleOrchestrationClient();

    await generateArticleDraftFromIdea({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "autopilot",
      jobMetadata: { scheduledRunId: "run-9" },
      client: client as never,
    });

    const insertArg = client.__chains.article_jobs!.insert.mock
      .calls[0]![0] as {
      type: string;
      input: {
        triggerSource: string;
        ideaId: string;
        ideaSnapshot: Record<string, unknown>;
        blogSettingsSnapshot: Record<string, unknown>;
        teamId: string;
        scheduledRunId: string;
      };
    };
    expect(insertArg.type).toBe("generate_article");
    expect(insertArg.input.triggerSource).toBe("autopilot");
    expect(insertArg.input.ideaId).toBe("idea-1");
    expect(insertArg.input.scheduledRunId).toBe("run-9");
    expect(insertArg.input.ideaSnapshot).toBeDefined();
    expect(insertArg.input.blogSettingsSnapshot).toBeDefined();
    expect(insertArg.input.teamId).toBe("t1");
  });

  it("seeds the article placeholder with the idea title and links it back to the idea", async () => {
    const client = makeArticleOrchestrationClient();

    await generateArticleDraftFromIdea({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "manual",
      client: client as never,
    });

    expect(client.__chains.articles!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        blog_id: "b1",
        user_id: "u1",
        article_idea_id: "idea-1",
        title: ideaRowStub.title,
        target_keyword: ideaRowStub.target_keyword,
        status: "generating",
      }),
    );
  });

  it("calls the AI provider with a brief built from the idea", async () => {
    const client = makeArticleOrchestrationClient();

    await generateArticleDraftFromIdea({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "manual",
      client: client as never,
    });

    const call = mockedGenerateArticleDraft.mock.calls[0]![0] as {
      brief: string;
      blogName: string;
    };
    expect(call.blogName).toBe("Acme");
    expect(call.brief).toContain(ideaRowStub.title);
    expect(call.brief).toContain(ideaRowStub.target_keyword!);
  });

  it("passes blogDescription as undefined when the blog row has none", async () => {
    const client = makeArticleOrchestrationClient();
    // `getBlogGenerationContext` runs in BOTH the queue and the run
    // phase now, so use `mockResolvedValue` (not `Once`) to cover both
    // calls with the empty-description fixture.
    client.__chains.blogs!.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "b1",
        name: "Acme",
        description: "",
        slug: "acme",
        project_id: "p1",
        settings: {},
      },
      error: null,
    });

    await generateArticleDraftFromIdea({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "manual",
      client: client as never,
    });

    const call = mockedGenerateArticleDraft.mock.calls[0]![0] as {
      blogDescription?: string;
    };
    expect(call.blogDescription).toBeUndefined();
  });

  it("uses the job id as the consume_team_tokens idempotency key", async () => {
    const client = makeArticleOrchestrationClient();

    await generateArticleDraftFromIdea({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "manual",
      client: client as never,
    });

    expect(mockedConsumeTeamTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "t1",
        amount: 5,
        actingUserId: "u1",
        idempotencyKey: "article_job::job-X",
        metadata: expect.objectContaining({
          blog_id: "b1",
          job_id: "job-X",
          job_type: "generate_article",
          idea_id: "idea-1",
          trigger_source: "manual",
        }),
      }),
    );
  });

  it("converts the idea to converted_to_article on success", async () => {
    const client = makeArticleOrchestrationClient();

    await generateArticleDraftFromIdea({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "manual",
      client: client as never,
    });

    // article_ideas.update is called with status=converted_to_article
    // by convertIdeaToArticle (after the post-AI article update, in the
    // happy path).
    expect(client.__chains.article_ideas!.update).toHaveBeenCalledWith({
      status: "converted_to_article",
    });
  });

  it("logs a usage_event with the model + token counts", async () => {
    const client = makeArticleOrchestrationClient();

    await generateArticleDraftFromIdea({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "manual",
      client: client as never,
    });

    expect(client.__chains.usage_events!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        blog_id: "b1",
        article_id: "article-X",
        article_idea_id: "idea-1",
        job_id: "job-X",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        input_tokens: 2200,
        output_tokens: 1800,
        credits_used: 5,
      }),
    );
  });

  it("marks the job completed with a structured output payload", async () => {
    const client = makeArticleOrchestrationClient();

    await generateArticleDraftFromIdea({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "manual",
      client: client as never,
    });

    const updateCalls = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0],
    );
    const completed = updateCalls.find((u) => u.status === "completed");
    expect(completed).toBeDefined();
    expect(completed!.output).toMatchObject({
      model: "claude-sonnet-4-6",
      promptTokens: 2200,
      completionTokens: 1800,
      wordCount: 1623,
      creditsUsed: 5,
    });
  });

  it("throws blog_not_found when the blog is missing", async () => {
    const client = makeClient({
      blogs: { data: null, error: null },
    });

    await expect(
      generateArticleDraftFromIdea({
        blogId: "missing",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toThrow(/blog_not_found/);

    // No article_jobs / article_ideas chains were ever materialized,
    // which itself proves nothing was written. (`from(...)` lazily
    // creates the chain on first access.)
    expect(client.__chains.article_jobs).toBeUndefined();
    expect(client.__chains.article_ideas).toBeUndefined();
  });

  it("throws idea_not_found when the idea is missing", async () => {
    const client = makeArticleOrchestrationClient({ ideaMissing: true });

    await expect(
      generateArticleDraftFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-missing",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toThrow(/idea_not_found/);

    expect(client.__chains.article_jobs!.insert).not.toHaveBeenCalled();
  });

  it("throws idea_not_approved when the idea is in another status", async () => {
    const client = makeArticleOrchestrationClient({ ideaStatus: "generated" });

    await expect(
      generateArticleDraftFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toThrow(/idea_not_approved/);

    expect(client.__chains.article_jobs!.insert).not.toHaveBeenCalled();
    expect(mockedConsumeTeamTokens).not.toHaveBeenCalled();
  });

  it("propagates supabase errors when reading the idea", async () => {
    const client = makeArticleOrchestrationClient();
    client.__chains.article_ideas!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "read boom" } });

    await expect(
      generateArticleDraftFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "read boom" });
  });

  it("marks article + job failed when consume_team_tokens fails (no refund — never consumed)", async () => {
    const client = makeArticleOrchestrationClient();
    mockedConsumeTeamTokens.mockRejectedValueOnce(
      new Error("insufficient_tokens"),
    );

    await expect(
      generateArticleDraftFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toThrow(/insufficient_tokens/);

    // Article placeholder WAS created in the queue phase (before the
    // workflow even tries to consume tokens). The catch in the run
    // phase then marks it failed.
    expect(client.__chains.articles!.insert).toHaveBeenCalled();
    expect(client.__chains.articles!.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message: expect.stringContaining("insufficient_tokens"),
      }),
    );
    // The idea was NOT touched (still approved → user can retry).
    expect(client.__chains.article_ideas!.update).not.toHaveBeenCalled();
    // The job was marked failed.
    const updateCalls = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0],
    );
    expect(updateCalls.some((u) => u.status === "failed")).toBe(true);
    // CRITICAL: no refund — credits were never consumed.
    expect(mockedRefundTeamTokens).not.toHaveBeenCalled();
  });

  it("refunds credits + stamps output.refunded when the AI call fails", async () => {
    const client = makeArticleOrchestrationClient();
    mockedGenerateArticleDraft.mockRejectedValueOnce(
      new Error("schema mismatch"),
    );

    await expect(
      generateArticleDraftFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toThrow(/schema mismatch/);

    // Article placeholder was created and then marked failed.
    expect(client.__chains.articles!.insert).toHaveBeenCalled();
    expect(client.__chains.articles!.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message: expect.stringContaining("schema mismatch"),
      }),
    );
    // Job was marked failed.
    const updateCalls = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0],
    );
    expect(updateCalls.some((u) => u.status === "failed")).toBe(true);
    // Idea status NEVER touched.
    expect(client.__chains.article_ideas!.update).not.toHaveBeenCalled();
    // Credits were refunded with the right idempotency key + metadata.
    expect(mockedRefundTeamTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "t1",
        amount: 5,
        actingUserId: "u1",
        idempotencyKey: "refund::article_job::job-X",
        metadata: expect.objectContaining({
          refunded_for_job_id: "job-X",
          refunded_for_blog_id: "b1",
          refunded_for_idea_id: "idea-1",
          reason: expect.stringContaining("schema mismatch"),
        }),
      }),
    );
    // Job output was stamped with refunded=true (last update on the
    // jobs chain after the failure path).
    const refundedUpdate = updateCalls.find(
      (u) =>
        (u.output as Record<string, unknown> | undefined)?.refunded === true,
    );
    expect(refundedUpdate).toBeDefined();
    const output = refundedUpdate!.output as Record<string, unknown>;
    expect(output.refundedCredits).toBe(5);
    expect(typeof output.refundedAt).toBe("string");
  });

  it("fails the job (no consume, no refund) when the article placeholder insert fails in the queue phase", async () => {
    const client = makeArticleOrchestrationClient({
      insertArticleError: { message: "constraint violation" },
    });

    await expect(
      generateArticleDraftFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "constraint violation" });

    // Queue marks the job failed and bails out before any consume.
    const updateCalls = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0],
    );
    expect(updateCalls.some((u) => u.status === "failed")).toBe(true);
    // Idea wasn't touched.
    expect(client.__chains.article_ideas!.update).not.toHaveBeenCalled();
    // No tokens consumed → no refund.
    expect(mockedConsumeTeamTokens).not.toHaveBeenCalled();
    expect(mockedRefundTeamTokens).not.toHaveBeenCalled();
  });

  it("refunds credits when the post-AI article update fails", async () => {
    const client = makeArticleOrchestrationClient({
      updateArticleError: { message: "update boom" },
    });

    await expect(
      generateArticleDraftFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "update boom" });

    const articleUpdates = client.__chains.articles!.update.mock.calls.map(
      (c) => c[0],
    );
    expect(articleUpdates.some((u) => u.status === "failed")).toBe(true);
    expect(client.__chains.article_ideas!.update).not.toHaveBeenCalled();
    expect(mockedRefundTeamTokens).toHaveBeenCalledOnce();
  });

  it("uses the admin client when none is injected", async () => {
    const client = makeArticleOrchestrationClient();
    mockedCreateAdmin.mockReturnValue(client as never);

    await generateArticleDraftFromIdea({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "manual",
    });

    expect(mockedCreateAdmin).toHaveBeenCalled();
  });

  it("propagates non-Error throws as their string form (no refund — consume failed)", async () => {
    const client = makeArticleOrchestrationClient();
    mockedConsumeTeamTokens.mockRejectedValueOnce("plain-string-failure");

    await expect(
      generateArticleDraftFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toBe("plain-string-failure");

    const failedCall = client.__chains.article_jobs!.update.mock.calls.find(
      (c) => (c[0] as { status?: string }).status === "failed",
    );
    expect(failedCall).toBeDefined();
    expect((failedCall![0] as { error_message: string }).error_message).toBe(
      "plain-string-failure",
    );
    // Consume failed → no refund.
    expect(mockedRefundTeamTokens).not.toHaveBeenCalled();
  });

  it("propagates non-Error throws after consume — refunds and surfaces the original throw", async () => {
    const client = makeArticleOrchestrationClient();
    mockedGenerateArticleDraft.mockRejectedValueOnce("oh no");

    await expect(
      generateArticleDraftFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toBe("oh no");

    expect(mockedRefundTeamTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "refund::article_job::job-X",
        metadata: expect.objectContaining({ reason: "oh no" }),
      }),
    );
  });

  it("never refunds on the happy path", async () => {
    const client = makeArticleOrchestrationClient();

    await generateArticleDraftFromIdea({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "manual",
      client: client as never,
    });

    expect(mockedRefundTeamTokens).not.toHaveBeenCalled();
  });

  it("preserves an existing job.output payload when stamping refunded fields", async () => {
    const client = makeArticleOrchestrationClient();
    // The article_jobs chain sees TWO maybeSingle calls during a
    // failed run:
    //   1. updateArticleJobStatus({incrementAttempts:true}) reads `attempts`
    //   2. markJobRefunded() reads `output`
    // Sequence the mock so we can verify the second read's payload
    // makes it into the merged update.
    const articleJobsChain = client.__chains.article_jobs!;
    articleJobsChain.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: { id: "job-X", attempts: 0 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { output: { previousField: "value" } },
        error: null,
      });
    mockedGenerateArticleDraft.mockRejectedValueOnce(new Error("ai down"));

    await expect(
      generateArticleDraftFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toThrow(/ai down/);

    const updateCalls = articleJobsChain.update.mock.calls.map((c) => c[0]);
    const refundedUpdate = updateCalls.find(
      (u) =>
        (u.output as Record<string, unknown> | undefined)?.refunded === true,
    );
    expect(refundedUpdate).toBeDefined();
    const output = refundedUpdate!.output as Record<string, unknown>;
    expect(output.previousField).toBe("value");
    expect(output.refunded).toBe(true);
  });

  it("treats a non-object job.output as empty when stamping refunded fields", async () => {
    const client = makeArticleOrchestrationClient();
    const articleJobsChain = client.__chains.article_jobs!;
    articleJobsChain.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: { id: "job-X", attempts: 0 },
        error: null,
      })
      // Defensive guard: if `output` somehow was an array or scalar.
      .mockResolvedValueOnce({
        data: { output: ["unexpected", "shape"] },
        error: null,
      });
    mockedGenerateArticleDraft.mockRejectedValueOnce(new Error("ai down"));

    await expect(
      generateArticleDraftFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toThrow(/ai down/);

    const refundedUpdate = articleJobsChain.update.mock.calls
      .map((c) => c[0])
      .find(
        (u) =>
          (u.output as Record<string, unknown> | undefined)?.refunded === true,
      );
    expect(refundedUpdate).toBeDefined();
    // The bad shape is dropped — we only write the refunded fields.
    const output = refundedUpdate!.output as Record<string, unknown>;
    expect(Object.keys(output).sort()).toEqual([
      "refunded",
      "refundedAt",
      "refundedCredits",
    ]);
  });

  it("propagates errors from the markJobRefunded read", async () => {
    // markJobRefunded throws if its read fails; the outer catch's
    // refund-try-block swallows it (the original error is what matters).
    // This test exercises the swallow path indirectly — the user still
    // sees the original throw and we don't get a noisy stack.
    const client = makeArticleOrchestrationClient();
    const articleJobsChain = client.__chains.article_jobs!;
    articleJobsChain.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: { id: "job-X", attempts: 0 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "read boom" },
      });
    mockedGenerateArticleDraft.mockRejectedValueOnce(new Error("ai down"));

    await expect(
      generateArticleDraftFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toThrow(/ai down/);

    // Refund still happened — markJobRefunded failed silently.
    expect(mockedRefundTeamTokens).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// queueGenerateArticleFromIdea — durable enqueue (no token consumption)
// ============================================================================

describe("queueGenerateArticleFromIdea", () => {
  it("creates job + article placeholder + links them, returns ids without consuming tokens", async () => {
    const client = makeArticleOrchestrationClient();

    const result = await queueGenerateArticleFromIdea({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "manual",
      client: client as never,
    });

    expect(result.jobId).toBe("job-X");
    expect(result.articleId).toBe("article-X");
    expect(result.ideaId).toBe("idea-1");
    expect(result.status).toBe("pending");
    expect(result.alreadyQueued).toBe(false);
    // No token consumption in queue.
    expect(mockedConsumeTeamTokens).not.toHaveBeenCalled();
    // Article placeholder was inserted in `generating` state.
    expect(client.__chains.articles!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "generating",
        article_idea_id: "idea-1",
      }),
    );
    // Job row was created with the snapshot input.
    expect(client.__chains.article_jobs!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "generate_article",
        article_idea_id: "idea-1",
        input: expect.objectContaining({
          triggerSource: "manual",
          teamId: "t1",
          ideaId: "idea-1",
          ideaSnapshot: expect.objectContaining({ title: ideaRowStub.title }),
          blogSettingsSnapshot: expect.any(Object),
        }),
      }),
    );
  });

  it("returns the existing job when one is already pending/processing for the idea", async () => {
    const client = makeArticleOrchestrationClient();
    // Override the article_jobs `then` resolver so the idempotency
    // check (.in("status",[...]).order().limit(1)) yields an existing
    // active row.
    client.__chains.article_jobs!.then = ((
      onFulfilled?: ((v: unknown) => unknown) | null,
      onRejected?: ((r: unknown) => unknown) | null,
    ) =>
      Promise.resolve({
        data: [
          {
            id: "job-existing",
            article_id: "article-existing",
            status: "processing",
          },
        ],
        error: null,
      }).then(
        onFulfilled,
        onRejected,
      )) as typeof client.__chains.article_jobs.then;

    const result = await queueGenerateArticleFromIdea({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "manual",
      client: client as never,
    });

    expect(result).toEqual({
      jobId: "job-existing",
      articleId: "article-existing",
      ideaId: "idea-1",
      status: "processing",
      alreadyQueued: true,
    });
    // No new job, no new article were created.
    expect(client.__chains.article_jobs!.insert).not.toHaveBeenCalled();
    expect(client.__chains.articles!.insert).not.toHaveBeenCalled();
  });

  it("propagates the idempotency-check supabase error", async () => {
    const client = makeArticleOrchestrationClient();
    client.__chains.article_jobs!.then = ((
      onFulfilled?: ((v: unknown) => unknown) | null,
      onRejected?: ((r: unknown) => unknown) | null,
    ) =>
      Promise.resolve({
        data: null,
        error: { message: "active jobs query boom" },
      }).then(
        onFulfilled,
        onRejected,
      )) as typeof client.__chains.article_jobs.then;

    await expect(
      queueGenerateArticleFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "active jobs query boom" });
  });

  it("propagates blog_not_found / idea_not_found / idea_not_approved", async () => {
    const blogMissingClient = makeClient({
      blogs: { data: null, error: null },
    });
    await expect(
      queueGenerateArticleFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: blogMissingClient as never,
      }),
    ).rejects.toThrow(/blog_not_found/);

    const ideaMissingClient = makeArticleOrchestrationClient({
      ideaMissing: true,
    });
    await expect(
      queueGenerateArticleFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-missing",
        triggerSource: "manual",
        client: ideaMissingClient as never,
      }),
    ).rejects.toThrow(/idea_not_found/);

    const wrongStatusClient = makeArticleOrchestrationClient({
      ideaStatus: "generated",
    });
    await expect(
      queueGenerateArticleFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: wrongStatusClient as never,
      }),
    ).rejects.toThrow(/idea_not_approved/);
  });

  it("marks the job failed and propagates when the article placeholder insert fails", async () => {
    const client = makeArticleOrchestrationClient({
      insertArticleError: { message: "constraint violation" },
    });

    await expect(
      queueGenerateArticleFromIdea({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "constraint violation" });

    const updateCalls = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0],
    );
    expect(updateCalls.some((u) => u.status === "failed")).toBe(true);
    // CRITICAL: still no consume.
    expect(mockedConsumeTeamTokens).not.toHaveBeenCalled();
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makeArticleOrchestrationClient();
    mockedCreateAdmin.mockReturnValue(client as never);

    await queueGenerateArticleFromIdea({
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "manual",
    });

    expect(mockedCreateAdmin).toHaveBeenCalled();
  });
});

// ============================================================================
// runGenerateArticleFromIdeaJob — workflow step body
// ============================================================================

describe("runGenerateArticleFromIdeaJob", () => {
  beforeEach(() => {
    mockedGenerateArticleDraft.mockResolvedValue(draftStub as never);
    mockedConsumeTeamTokens.mockResolvedValue(95);
    mockedRefundTeamTokens.mockResolvedValue(100);
  });

  it("runs the generation against pre-existing job + article ids", async () => {
    const client = makeArticleOrchestrationClient();

    const result = await runGenerateArticleFromIdeaJob({
      jobId: "job-existing",
      articleId: "article-existing",
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      triggerSource: "manual",
      client: client as never,
    });

    expect(result.jobId).toBe("job-existing");
    expect(result.articleId).toBe("article-existing");
    expect(result.status).toBe("ready_for_review");
    // Consumes against the pre-existing job id.
    expect(mockedConsumeTeamTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "article_job::job-existing",
        metadata: expect.objectContaining({ trigger_source: "manual" }),
      }),
    );
    // Idea was converted_to_article.
    expect(client.__chains.article_ideas!.update).toHaveBeenCalledWith({
      status: "converted_to_article",
    });
  });

  it("defaults trigger_source metadata to 'workflow' when not provided", async () => {
    const client = makeArticleOrchestrationClient();

    await runGenerateArticleFromIdeaJob({
      jobId: "job-1",
      articleId: "article-1",
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      client: client as never,
    });

    expect(mockedConsumeTeamTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ trigger_source: "workflow" }),
      }),
    );
  });

  it("merges jobInputPatch into the existing article_jobs.input jsonb", async () => {
    const client = makeArticleOrchestrationClient();
    // The article_jobs chain's `maybeSingle` is hit twice: first for
    // the jobInputPatch merge, then by `updateArticleJobStatus` to
    // read the current `attempts` count. Provide the input row first
    // and a default for everything else.
    client.__chains.article_jobs!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: { input: { triggerSource: "manual" } },
        error: null,
      })
      .mockResolvedValue({ data: { attempts: 0 }, error: null });

    await runGenerateArticleFromIdeaJob({
      jobId: "job-1",
      articleId: "article-1",
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      jobInputPatch: { workflowRunId: "run-1" },
      client: client as never,
    });

    const inputUpdate = client.__chains
      .article_jobs!.update.mock.calls.map((c) => c[0])
      .find((u) => "input" in u);
    expect(inputUpdate).toBeDefined();
    expect(inputUpdate!.input).toMatchObject({
      triggerSource: "manual",
      workflowRunId: "run-1",
    });
  });

  it("treats a non-object existing input as empty when merging the patch", async () => {
    const client = makeArticleOrchestrationClient();
    client.__chains.article_jobs!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { input: null }, error: null })
      .mockResolvedValue({ data: { attempts: 0 }, error: null });

    await runGenerateArticleFromIdeaJob({
      jobId: "job-1",
      articleId: "article-1",
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      jobInputPatch: { workflowRunId: "run-1" },
      client: client as never,
    });

    const inputUpdate = client.__chains
      .article_jobs!.update.mock.calls.map((c) => c[0])
      .find((u) => "input" in u);
    expect(inputUpdate!.input).toEqual({ workflowRunId: "run-1" });
  });

  it("propagates the read error when merging jobInputPatch", async () => {
    const client = makeArticleOrchestrationClient();
    client.__chains.article_jobs!.maybeSingle = vi.fn().mockResolvedValueOnce({
      data: null,
      error: { message: "input read boom" },
    });

    await expect(
      runGenerateArticleFromIdeaJob({
        jobId: "job-1",
        articleId: "article-1",
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        jobInputPatch: { workflowRunId: "run-1" },
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "input read boom" });
  });

  it("ignores an empty jobInputPatch (no merge round-trip)", async () => {
    const client = makeArticleOrchestrationClient();

    await runGenerateArticleFromIdeaJob({
      jobId: "job-1",
      articleId: "article-1",
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
      jobInputPatch: {},
      client: client as never,
    });

    // No update call carries an `input` field — the merge path
    // never fires for an empty patch, so the only writes to
    // article_jobs are status / step / attempts patches.
    const updates = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0] as Record<string, unknown>,
    );
    expect(updates.some((u) => "input" in u)).toBe(false);
  });

  it("fails fast when the blog vanished between queue and run", async () => {
    const client = makeClient({
      blogs: { data: null, error: null },
    });

    await expect(
      runGenerateArticleFromIdeaJob({
        jobId: "job-1",
        articleId: "article-1",
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        client: client as never,
      }),
    ).rejects.toThrow(/blog_not_found/);
    expect(mockedConsumeTeamTokens).not.toHaveBeenCalled();
  });

  it("fails fast when the idea was already converted by a parallel run", async () => {
    const client = makeArticleOrchestrationClient({
      ideaStatus: "converted_to_article",
    });

    await expect(
      runGenerateArticleFromIdeaJob({
        jobId: "job-1",
        articleId: "article-1",
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        client: client as never,
      }),
    ).rejects.toThrow(/idea_not_approved/);
    expect(mockedConsumeTeamTokens).not.toHaveBeenCalled();
  });

  it("propagates the idea-load supabase error", async () => {
    const client = makeArticleOrchestrationClient();
    client.__chains.article_ideas!.maybeSingle = vi.fn().mockResolvedValueOnce({
      data: null,
      error: { message: "idea read boom" },
    });

    await expect(
      runGenerateArticleFromIdeaJob({
        jobId: "job-1",
        articleId: "article-1",
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "idea read boom" });
  });

  it("fails fast when the idea row is missing from the run", async () => {
    const client = makeArticleOrchestrationClient({ ideaMissing: true });

    await expect(
      runGenerateArticleFromIdeaJob({
        jobId: "job-1",
        articleId: "article-1",
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        client: client as never,
      }),
    ).rejects.toThrow(/idea_not_found/);
    expect(mockedConsumeTeamTokens).not.toHaveBeenCalled();
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makeArticleOrchestrationClient();
    mockedCreateAdmin.mockReturnValue(client as never);

    await runGenerateArticleFromIdeaJob({
      jobId: "job-1",
      articleId: "article-1",
      blogId: "b1",
      teamId: "t1",
      userId: "u1",
      ideaId: "idea-1",
    });

    expect(mockedCreateAdmin).toHaveBeenCalled();
  });
});

// ============================================================================
// getActiveGenerateArticleIdeaIds
// ============================================================================

describe("getActiveGenerateArticleIdeaIds", () => {
  it("returns an empty Set when ideaIds is empty (no DB round-trip)", async () => {
    const client = makeClient({});
    const result = await getActiveGenerateArticleIdeaIds(
      "b1",
      [],
      client as never,
    );
    expect(result.size).toBe(0);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns the set of idea ids with a pending/processing job", async () => {
    const client = makeClient({
      article_jobs: {
        data: [
          { article_idea_id: "i1" },
          { article_idea_id: "i2" },
          // null entries are filtered out (defensive against the FK
          // being on-delete-set-null for article_idea_id).
          { article_idea_id: null },
        ],
        error: null,
      },
    });

    const result = await getActiveGenerateArticleIdeaIds(
      "b1",
      ["i1", "i2", "i3"],
      client as never,
    );

    expect([...result].sort()).toEqual(["i1", "i2"]);
    expect(client.from).toHaveBeenCalledWith("article_jobs");
    expect(client.__chains.article_jobs!.eq).toHaveBeenCalledWith(
      "blog_id",
      "b1",
    );
    expect(client.__chains.article_jobs!.eq).toHaveBeenCalledWith(
      "type",
      "generate_article",
    );
    expect(client.__chains.article_jobs!.in).toHaveBeenCalledWith("status", [
      "pending",
      "processing",
    ]);
    expect(client.__chains.article_jobs!.in).toHaveBeenCalledWith(
      "article_idea_id",
      ["i1", "i2", "i3"],
    );
  });

  it("returns an empty Set when the query returns no rows", async () => {
    const client = makeClient({
      article_jobs: { data: [], error: null },
    });

    const result = await getActiveGenerateArticleIdeaIds(
      "b1",
      ["i1"],
      client as never,
    );
    expect(result.size).toBe(0);
  });

  it("returns an empty Set when data is null", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: null },
    });

    const result = await getActiveGenerateArticleIdeaIds(
      "b1",
      ["i1"],
      client as never,
    );
    expect(result.size).toBe(0);
  });

  it("propagates the supabase error", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: { message: "boom" } },
    });

    await expect(
      getActiveGenerateArticleIdeaIds("b1", ["i1"], client as never),
    ).rejects.toMatchObject({ message: "boom" });
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makeClient({
      article_jobs: { data: [], error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await getActiveGenerateArticleIdeaIds("b1", ["i1"]);

    expect(mockedCreateAdmin).toHaveBeenCalled();
  });
});

// ============================================================================
// listActiveArticleJobsForUser
// ============================================================================

describe("listActiveArticleJobsForUser", () => {
  function makeJobsClient(rows: unknown) {
    return makeClient({
      article_jobs: { data: rows, error: null },
    });
  }

  const baseRow = {
    id: "job-1",
    type: "generate_article",
    status: "processing",
    current_step: "writing_article",
    error_message: null,
    output: null,
    created_at: "2026-05-11T00:00:00Z",
    started_at: "2026-05-11T00:00:01Z",
    completed_at: null,
    article_idea_id: "idea-1",
    blog: {
      id: "b1",
      name: "Indie Stories",
      project_id: "p1",
      project: { team_id: "t1" },
    },
    article: { id: "article-1", title: "Draft title", status: "generating" },
  };

  it("returns shaped rows with denormalized blog + article data", async () => {
    const client = makeJobsClient([baseRow]);

    const rows = await listActiveArticleJobsForUser(client as never);

    expect(rows).toEqual([
      {
        id: "job-1",
        type: "generate_article",
        status: "processing",
        currentStep: "writing_article",
        errorMessage: null,
        output: null,
        createdAt: "2026-05-11T00:00:00Z",
        startedAt: "2026-05-11T00:00:01Z",
        completedAt: null,
        ideaId: "idea-1",
        blog: {
          id: "b1",
          name: "Indie Stories",
          projectId: "p1",
          teamId: "t1",
        },
        article: {
          id: "article-1",
          title: "Draft title",
          status: "generating",
        },
      },
    ]);
  });

  it("queries the right table with the active-or-recent OR clause", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T00:30:00Z"));
    const client = makeJobsClient([]);

    await listActiveArticleJobsForUser(client as never);

    expect(client.from).toHaveBeenCalledWith("article_jobs");
    const orArg = client.__chains.article_jobs!.or.mock.calls[0]![0];
    expect(orArg).toContain("status.in.(pending,processing)");
    // Cutoff = now - default window (5 min) = 00:25:00.000Z
    expect(orArg).toContain("completed_at.gte.2026-05-11T00:25:00.000Z");
  });

  it("respects a custom recentWindowMs and limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T00:30:00Z"));
    const client = makeJobsClient([]);

    await listActiveArticleJobsForUser(client as never, {
      recentWindowMs: 60_000,
      limit: 5,
    });

    const orArg = client.__chains.article_jobs!.or.mock.calls[0]![0];
    expect(orArg).toContain("completed_at.gte.2026-05-11T00:29:00.000Z");
    expect(client.__chains.article_jobs!.limit).toHaveBeenCalledWith(5);
  });

  it("returns [] when supabase yields null data with no error", async () => {
    const client = makeJobsClient(null);

    const rows = await listActiveArticleJobsForUser(client as never);
    expect(rows).toEqual([]);
  });

  it("propagates supabase errors", async () => {
    const client = makeClient({
      article_jobs: { data: null, error: { message: "boom" } },
    });

    await expect(
      listActiveArticleJobsForUser(client as never),
    ).rejects.toMatchObject({ message: "boom" });
  });

  it("handles supabase returning the FK joins as arrays (cardinality fallback)", async () => {
    const client = makeJobsClient([
      {
        ...baseRow,
        blog: [
          {
            id: "b1",
            name: "Indie Stories",
            project_id: "p1",
            project: [{ team_id: "t1" }],
          },
        ],
        article: [
          { id: "article-1", title: "Draft", status: "ready_for_review" },
        ],
      },
    ]);

    const rows = await listActiveArticleJobsForUser(client as never);
    expect(rows[0]?.blog.teamId).toBe("t1");
    expect(rows[0]?.article?.status).toBe("ready_for_review");
  });

  it("skips rows whose blog FK is missing (defensive)", async () => {
    const client = makeJobsClient([{ ...baseRow, blog: null }]);

    const rows = await listActiveArticleJobsForUser(client as never);
    expect(rows).toEqual([]);
  });

  it("returns null article when the job has no linked article yet", async () => {
    const client = makeJobsClient([{ ...baseRow, article: null }]);

    const rows = await listActiveArticleJobsForUser(client as never);
    expect(rows[0]?.article).toBeNull();
  });

  it("exposes a sane default recent-window constant (5 min)", () => {
    expect(ACTIVE_JOB_RECENT_WINDOW_MS).toBe(5 * 60_000);
  });
});

// ============================================================================
// reconcileStuckArticleJobs
// ============================================================================

describe("reconcileStuckArticleJobs", () => {
  beforeEach(() => {
    mockedRefundTeamTokens.mockResolvedValue(100);
  });

  function makeStuckJob(
    overrides: Partial<{
      id: string;
      type: string;
      blog_id: string;
      article_id: string | null;
      article_idea_id: string | null;
      input: Record<string, unknown>;
      output: Record<string, unknown>;
      created_at: string;
    }> = {},
  ) {
    return {
      id: "stuck-1",
      type: "generate_article" as const,
      blog_id: "b1",
      article_id: "article-1",
      article_idea_id: "idea-1",
      input: { teamId: "t1", ideaId: "idea-1" },
      output: {},
      started_at: "2026-05-11T00:00:00Z",
      created_at: "2026-05-11T00:00:00Z",
      ...overrides,
    };
  }

  function makeReconcileClient(opts: {
    stuckJobsByType: Record<string, unknown[]>;
    articleStatusById?: Record<string, string>;
    ledgerByJobId?: Record<
      string,
      Array<{ idempotency_key: string; amount: number; user_id: string }>
    >;
  }): MockClient {
    const client = makeClient({});

    // article_jobs chain handles BOTH the find query (.lt(...).order().limit())
    // AND the failArticleJob update later. We script the find via the
    // chain's `then` so the same chain object can satisfy both.
    let scriptedTypeIndex = 0;
    const typeOrder = Object.keys(opts.stuckJobsByType);
    client.__chains.article_jobs = makeChain({ data: null, error: null });
    client.__chains.article_jobs.then = ((
      onFulfilled?: ((v: unknown) => unknown) | null,
      onRejected?: ((r: unknown) => unknown) | null,
    ) => {
      const type = typeOrder[scriptedTypeIndex] ?? null;
      scriptedTypeIndex += 1;
      const data = type ? (opts.stuckJobsByType[type] ?? []) : [];
      return Promise.resolve({ data, error: null }).then(
        onFulfilled,
        onRejected,
      );
    }) as typeof client.__chains.article_jobs.then;

    // articles chain: maybeSingle returns the placeholder's status by id.
    let articlesMaybeSingleCallCount = 0;
    const articlesMockOrder: string[] = []; // we'll capture .eq("id", X) calls
    client.__chains.articles = makeChain({ data: null, error: null });
    const originalArticlesEq = client.__chains.articles.eq;
    client.__chains.articles.eq = vi.fn((column: string, value: string) => {
      if (column === "id") articlesMockOrder.push(value);
      return originalArticlesEq.call(client.__chains.articles, column, value);
    }) as never;
    client.__chains.articles.maybeSingle = vi.fn(() => {
      const id = articlesMockOrder[articlesMaybeSingleCallCount];
      articlesMaybeSingleCallCount += 1;
      const status = opts.articleStatusById?.[id ?? ""] ?? null;
      return Promise.resolve({
        data: status ? { status } : null,
        error: null,
      });
    }) as never;

    // token_transactions chain: ledger lookups by idempotency_key.in([...]).
    let ledgerCallIndex = 0;
    const ledgerJobIds: string[] = [];
    client.__chains.token_transactions = makeChain({
      data: null,
      error: null,
    });
    const originalTxIn = client.__chains.token_transactions.in;
    client.__chains.token_transactions.in = vi.fn(
      (column: string, values: unknown[]) => {
        if (column === "idempotency_key" && Array.isArray(values)) {
          // The first key in the .in([...]) is the usage key:
          // article_job::{jobId}. Extract the jobId.
          const first = values[0] as string;
          const match = first?.match?.(/article_job::(.+)/);
          if (match) ledgerJobIds.push(match[1]);
        }
        return originalTxIn.call(
          client.__chains.token_transactions,
          column,
          values,
        );
      },
    ) as never;
    client.__chains.token_transactions.then = ((
      onFulfilled?: ((v: unknown) => unknown) | null,
      onRejected?: ((r: unknown) => unknown) | null,
    ) => {
      const jobId = ledgerJobIds[ledgerCallIndex];
      ledgerCallIndex += 1;
      const data = jobId ? (opts.ledgerByJobId?.[jobId] ?? []) : [];
      return Promise.resolve({ data, error: null }).then(
        onFulfilled,
        onRejected,
      );
    }) as typeof client.__chains.token_transactions.then;

    return client;
  }

  it("exposes default thresholds: 10 min for generate_article, 5 min for generate_ideas", () => {
    expect(DEFAULT_RECONCILE_THRESHOLDS_MINUTES).toEqual({
      generate_article: 10,
      generate_ideas: 5,
    });
  });

  it("returns a zeroed result when nothing is stuck", async () => {
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [], generate_ideas: [] },
    });

    const out = await reconcileStuckArticleJobs({ client: client as never });
    expect(out).toEqual({
      jobsChecked: 0,
      jobsFailed: 0,
      articlesFailed: 0,
      tokensRefunded: 0,
      errors: [],
    });
    expect(mockedRefundTeamTokens).not.toHaveBeenCalled();
  });

  it("uses the type-specific cutoff when olderThanMinutes is omitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T00:30:00Z"));
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [], generate_ideas: [] },
    });

    await reconcileStuckArticleJobs({ client: client as never });

    const ltCalls = client.__chains.article_jobs!.lt.mock.calls;
    expect(ltCalls.length).toBe(2);
    // generate_article — 10 min ago
    expect(ltCalls[0]).toEqual(["created_at", "2026-05-11T00:20:00.000Z"]);
    // generate_ideas — 5 min ago
    expect(ltCalls[1]).toEqual(["created_at", "2026-05-11T00:25:00.000Z"]);
  });

  it("uses the override threshold for ALL types when provided", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T00:30:00Z"));
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [] },
    });

    await reconcileStuckArticleJobs({
      client: client as never,
      jobType: "generate_article",
      olderThanMinutes: 1,
    });

    expect(client.__chains.article_jobs!.lt).toHaveBeenCalledWith(
      "created_at",
      "2026-05-11T00:29:00.000Z",
    );
  });

  it("scopes to a single type when jobType is set", async () => {
    const client = makeReconcileClient({
      stuckJobsByType: { generate_ideas: [] },
    });

    await reconcileStuckArticleJobs({
      client: client as never,
      jobType: "generate_ideas",
    });

    expect(client.__chains.article_jobs!.eq).toHaveBeenCalledWith(
      "type",
      "generate_ideas",
    );
    // Only ONE find query should fire.
    expect(client.__chains.article_jobs!.lt).toHaveBeenCalledTimes(1);
  });

  it("marks each stuck job failed AND its placeholder article failed", async () => {
    const job = makeStuckJob();
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [job], generate_ideas: [] },
      articleStatusById: { "article-1": "generating" },
      ledgerByJobId: { "stuck-1": [] },
    });

    const out = await reconcileStuckArticleJobs({ client: client as never });

    expect(out.jobsChecked).toBe(1);
    expect(out.jobsFailed).toBe(1);
    expect(out.articlesFailed).toBe(1);
    expect(out.errors).toEqual([]);

    // Job marked failed with the canonical timeout copy.
    const jobUpdates = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0] as Record<string, unknown>,
    );
    expect(
      jobUpdates.some(
        (u) =>
          u.status === "failed" &&
          typeof u.error_message === "string" &&
          (u.error_message as string).includes("timed out"),
      ),
    ).toBe(true);

    // Article marked failed.
    const articleUpdates = client.__chains.articles!.update.mock.calls.map(
      (c) => c[0] as Record<string, unknown>,
    );
    expect(articleUpdates).toContainEqual(
      expect.objectContaining({
        status: "failed",
        error_message: expect.stringContaining("timed out"),
      }),
    );
  });

  it("does NOT touch the article when it already moved on (status !== 'generating')", async () => {
    const job = makeStuckJob();
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [job], generate_ideas: [] },
      // The article quietly succeeded between the cron find and our touch.
      articleStatusById: { "article-1": "ready_for_review" },
      ledgerByJobId: { "stuck-1": [] },
    });

    const out = await reconcileStuckArticleJobs({ client: client as never });

    expect(out.jobsFailed).toBe(1);
    expect(out.articlesFailed).toBe(0);
    expect(client.__chains.articles!.update).not.toHaveBeenCalled();
  });

  it("skips the article update entirely when the job has no article_id", async () => {
    const job = makeStuckJob({ article_id: null });
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [job], generate_ideas: [] },
      ledgerByJobId: { "stuck-1": [] },
    });

    const out = await reconcileStuckArticleJobs({ client: client as never });

    expect(out.jobsFailed).toBe(1);
    expect(out.articlesFailed).toBe(0);
    expect(client.__chains.articles!.maybeSingle).not.toHaveBeenCalled();
  });

  it("refunds when a usage transaction exists and no refund transaction exists", async () => {
    const job = makeStuckJob();
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [job], generate_ideas: [] },
      articleStatusById: { "article-1": "generating" },
      ledgerByJobId: {
        "stuck-1": [
          {
            idempotency_key: "article_job::stuck-1",
            amount: -5,
            user_id: "owner-1",
          },
        ],
      },
    });

    const out = await reconcileStuckArticleJobs({ client: client as never });

    expect(out.tokensRefunded).toBe(5);
    expect(mockedRefundTeamTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "t1",
        amount: 5,
        actingUserId: "owner-1",
        idempotencyKey: "refund::article_job::stuck-1",
        metadata: expect.objectContaining({
          refunded_for_job_id: "stuck-1",
          reconciler: true,
        }),
      }),
    );
  });

  it("does NOT refund when no usage transaction exists", async () => {
    const job = makeStuckJob();
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [job], generate_ideas: [] },
      articleStatusById: { "article-1": "generating" },
      ledgerByJobId: { "stuck-1": [] },
    });

    const out = await reconcileStuckArticleJobs({ client: client as never });

    expect(out.tokensRefunded).toBe(0);
    expect(mockedRefundTeamTokens).not.toHaveBeenCalled();
  });

  it("does NOT double-refund when a refund transaction already exists", async () => {
    const job = makeStuckJob();
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [job], generate_ideas: [] },
      articleStatusById: { "article-1": "generating" },
      ledgerByJobId: {
        "stuck-1": [
          {
            idempotency_key: "article_job::stuck-1",
            amount: -5,
            user_id: "owner-1",
          },
          {
            idempotency_key: "refund::article_job::stuck-1",
            amount: 5,
            user_id: "owner-1",
          },
        ],
      },
    });

    const out = await reconcileStuckArticleJobs({ client: client as never });

    expect(out.jobsFailed).toBe(1);
    expect(out.tokensRefunded).toBe(0);
    expect(mockedRefundTeamTokens).not.toHaveBeenCalled();
  });

  it("records an error when the job has no teamId snapshot to refund against", async () => {
    const job = makeStuckJob({ input: { /* no teamId */ ideaId: "i" } });
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [job], generate_ideas: [] },
      articleStatusById: { "article-1": "generating" },
      ledgerByJobId: {
        "stuck-1": [
          {
            idempotency_key: "article_job::stuck-1",
            amount: -5,
            user_id: "owner-1",
          },
        ],
      },
    });

    const out = await reconcileStuckArticleJobs({ client: client as never });

    expect(out.jobsFailed).toBe(1);
    expect(out.tokensRefunded).toBe(0);
    expect(out.errors).toContainEqual(
      expect.stringContaining("missing teamId"),
    );
    expect(mockedRefundTeamTokens).not.toHaveBeenCalled();
  });

  it("records the error and continues when fetching stuck jobs fails for one type", async () => {
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [], generate_ideas: [] },
    });
    // Override generate_article fetch to error; generate_ideas still works.
    let callIndex = 0;
    client.__chains.article_jobs!.then = ((
      onFulfilled?: ((v: unknown) => unknown) | null,
      onRejected?: ((r: unknown) => unknown) | null,
    ) => {
      const isFirst = callIndex === 0;
      callIndex += 1;
      return Promise.resolve(
        isFirst
          ? { data: null, error: { message: "fetch boom" } }
          : { data: [], error: null },
      ).then(onFulfilled, onRejected);
    }) as typeof client.__chains.article_jobs.then;

    const out = await reconcileStuckArticleJobs({ client: client as never });

    expect(out.errors).toContainEqual(
      expect.stringContaining("fetch_generate_article: fetch boom"),
    );
    // generate_ideas still got scanned (no jobs found).
    expect(out.jobsChecked).toBe(0);
  });

  it("records the per-job error and keeps going when one job throws", async () => {
    // Two jobs scanned. The second one's article maybeSingle rejects
    // — the per-job try/catch should record the error and the loop
    // should continue with the rest of the run intact.
    const goodJob = makeStuckJob({
      id: "good",
      article_id: null, // skips the article path entirely
    });
    const badJob = makeStuckJob({ id: "bad", article_id: "art-bad" });
    const client = makeReconcileClient({
      stuckJobsByType: {
        generate_article: [goodJob, badJob],
        generate_ideas: [],
      },
      // good job has empty ledger → no refund
      ledgerByJobId: { good: [], bad: [] },
    });

    // Override articles.maybeSingle to reject for the SECOND call
    // (the bad job's article lookup) and resolve for everything else.
    let articleCallIndex = 0;
    client.__chains.articles!.maybeSingle = vi.fn(() => {
      articleCallIndex += 1;
      if (articleCallIndex === 1) {
        return Promise.resolve({
          data: null,
          error: { message: "article lookup boom" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    }) as never;

    const out = await reconcileStuckArticleJobs({ client: client as never });

    expect(out.jobsChecked).toBe(2);
    // The good job was fully processed; the bad one failed mid-way
    // but the JOB-level fail update still ran (it happens before the
    // article lookup). So jobsFailed === 2.
    expect(out.jobsFailed).toBe(2);
    expect(out.errors.length).toBe(1);
    expect(out.errors[0]).toContain("job_bad:");
    expect(out.errors[0]).toContain("article lookup boom");
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [], generate_ideas: [] },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await reconcileStuckArticleJobs();

    expect(mockedCreateAdmin).toHaveBeenCalled();
  });

  it("describes an Error throw using its .message", async () => {
    const job = makeStuckJob();
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [job], generate_ideas: [] },
      articleStatusById: { "article-1": "generating" },
      ledgerByJobId: {
        "stuck-1": [
          {
            idempotency_key: "article_job::stuck-1",
            amount: -5,
            user_id: "owner-1",
          },
        ],
      },
    });
    mockedRefundTeamTokens.mockRejectedValueOnce(new Error("billing API down"));

    const out = await reconcileStuckArticleJobs({ client: client as never });

    expect(out.errors).toContainEqual(
      expect.stringContaining("job_stuck-1: billing API down"),
    );
  });

  it("treats a null ledger response as 'no transactions' (no refund, no error)", async () => {
    const job = makeStuckJob({ article_id: null });
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [job], generate_ideas: [] },
    });
    // Force the ledger query to return null data with no error.
    client.__chains.token_transactions!.then = ((
      onFulfilled?: ((v: unknown) => unknown) | null,
      onRejected?: ((r: unknown) => unknown) | null,
    ) =>
      Promise.resolve({ data: null, error: null }).then(
        onFulfilled,
        onRejected,
      )) as typeof client.__chains.token_transactions.then;

    const out = await reconcileStuckArticleJobs({ client: client as never });

    expect(out.jobsFailed).toBe(1);
    expect(out.tokensRefunded).toBe(0);
    expect(out.errors).toEqual([]);
  });

  it("reads teamId safely from non-object job.input snapshots (defensive)", async () => {
    // Two stuck jobs, both with corrupt `input` snapshots:
    //   * one is `null` (oldest write before the orchestration
    //     started snapshotting)
    //   * one is an array (someone fat-fingered the jsonb)
    // Each should be marked failed but skip the refund attempt with
    // a "missing teamId" error rather than crashing.
    const nullInputJob = makeStuckJob({
      id: "null-input",
      article_id: null,
      input: null as never,
    });
    const arrayInputJob = makeStuckJob({
      id: "array-input",
      article_id: null,
      input: ["wrong", "shape"] as never,
    });
    const client = makeReconcileClient({
      stuckJobsByType: {
        generate_article: [nullInputJob, arrayInputJob],
        generate_ideas: [],
      },
      ledgerByJobId: {
        "null-input": [
          {
            idempotency_key: "article_job::null-input",
            amount: -5,
            user_id: "owner-1",
          },
        ],
        "array-input": [
          {
            idempotency_key: "article_job::array-input",
            amount: -5,
            user_id: "owner-1",
          },
        ],
      },
    });

    const out = await reconcileStuckArticleJobs({ client: client as never });

    expect(out.jobsFailed).toBe(2);
    expect(out.tokensRefunded).toBe(0);
    expect(out.errors.filter((e) => e.includes("missing teamId"))).toHaveLength(
      2,
    );
    expect(mockedRefundTeamTokens).not.toHaveBeenCalled();
  });

  it("describes a non-Error primitive throw with its String() form (no .message)", async () => {
    const job = makeStuckJob();
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [job], generate_ideas: [] },
      articleStatusById: { "article-1": "generating" },
      ledgerByJobId: {
        "stuck-1": [
          {
            idempotency_key: "article_job::stuck-1",
            amount: -5,
            user_id: "owner-1",
          },
        ],
      },
    });
    // refundTeamTokens rejects with a number — exercises the
    // describeErr fallback (not Error, not object-with-message).
    mockedRefundTeamTokens.mockRejectedValueOnce(42);

    const out = await reconcileStuckArticleJobs({ client: client as never });

    expect(out.errors).toContainEqual(
      expect.stringContaining("job_stuck-1: 42"),
    );
  });

  it("propagates the ledger query error as a per-job error in the result", async () => {
    const job = makeStuckJob({ article_id: null });
    const client = makeReconcileClient({
      stuckJobsByType: { generate_article: [job], generate_ideas: [] },
    });
    // Force the ledger lookup to error.
    client.__chains.token_transactions!.then = ((
      onFulfilled?: ((v: unknown) => unknown) | null,
      onRejected?: ((r: unknown) => unknown) | null,
    ) =>
      Promise.resolve({
        data: null,
        error: { message: "ledger boom" },
      }).then(
        onFulfilled,
        onRejected,
      )) as typeof client.__chains.token_transactions.then;

    const out = await reconcileStuckArticleJobs({ client: client as never });

    expect(out.errors).toContainEqual(expect.stringContaining("ledger boom"));
  });
});
