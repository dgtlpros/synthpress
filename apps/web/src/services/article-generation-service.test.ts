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
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateArticleDraft,
  generateIdeas,
} from "@/lib/ai/provider";
import { consumeTeamTokens } from "./team-billing-service";
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
  getBlogGenerationContext,
  isAllowedIdeaStatusTransition,
  listArticleIdeasForBlog,
  logUsageEvent,
  updateArticleIdeaStatus,
  updateArticleJobStatus,
} from "./article-generation-service";

const mockedGenerateIdeas = vi.mocked(generateIdeas);
const mockedGenerateArticleDraft = vi.mocked(generateArticleDraft);
const mockedConsumeTeamTokens = vi.mocked(consumeTeamTokens);

const mockedCreateAdmin = vi.mocked(createAdminClient);

// ---- Mock Supabase chain helpers ----------------------------------------

interface ChainResult<T> {
  data: T;
  error: { code?: string; message?: string } | null;
}

function makeChain<T>(result: ChainResult<T>) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  };
  // For inserts that don't .select(), terminal call resolves on the chain itself.
  // We patch update so a chained .eq returns a thenable that resolves.
  return chain;
}

interface MockClient {
  from: ReturnType<typeof vi.fn>;
  __chains: Record<string, ReturnType<typeof makeChain>>;
}

function makeClient(
  table: Record<string, ChainResult<unknown>>,
): MockClient {
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
    client.__chains.articles!.eq = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "article boom" } });

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
  client.__chains.article_ideas!.select = vi.fn().mockResolvedValue(
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

    const insertArg =
      client.__chains.article_jobs!.insert.mock.calls[0]![0] as {
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

    const insertArg =
      client.__chains.article_jobs!.insert.mock.calls[0]![0] as {
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
    const insertArg =
      client.__chains.article_jobs!.insert.mock.calls[0]![0] as {
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
    expect(
      updateCalls.some((u) => u.status === "failed"),
    ).toBe(true);
    // AI provider must NOT have been called.
    expect(mockedGenerateIdeas).not.toHaveBeenCalled();
  });

  it("marks the job failed when the AI provider throws (no refund in v1)", async () => {
    const client = makeOrchestrationClient();
    mockedGenerateIdeas.mockRejectedValueOnce(new Error("schema mismatch"));

    await expect(
      generateArticleIdeas({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        triggerSource: "manual",
        client: client as never,
      }),
    ).rejects.toThrow(/schema mismatch/);

    // Tokens were consumed before the AI call — that's intentional; v1
    // does not refund. Verify the consume happened.
    expect(mockedConsumeTeamTokens).toHaveBeenCalledOnce();

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
    client.__chains.article_ideas!.single = vi
      .fn()
      .mockResolvedValueOnce({
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
    expect(client.__chains.article_ideas!.eq).toHaveBeenCalledWith(
      "id",
      "i1",
    );
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
  client.__chains.articles!.single = vi.fn().mockResolvedValueOnce(
    opts?.insertArticleError
      ? { data: null, error: opts.insertArticleError }
      : { data: { id: "article-X" }, error: null },
  );
  // The post-AI update chain ends with .eq() — we need to control that
  // resolved value too. Default it to success unless overridden.
  client.__chains.articles!.eq = vi.fn(function (
    this: { __chain: typeof client.__chains.articles },
  ) {
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

    const insertArg = client.__chains.article_jobs!.insert.mock.calls[0]![0] as {
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
    client.__chains.blogs!.maybeSingle = vi.fn().mockResolvedValueOnce({
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

  it("marks only the job failed when consume_team_tokens fails (no article placeholder yet)", async () => {
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

    // No article placeholder was created.
    expect(client.__chains.articles!.insert).not.toHaveBeenCalled();
    // The idea was NOT touched.
    expect(client.__chains.article_ideas!.update).not.toHaveBeenCalled();
    // The job was marked failed.
    const updateCalls = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0],
    );
    expect(updateCalls.some((u) => u.status === "failed")).toBe(true);
  });

  it("marks both the article and the job failed when the AI call fails (idea stays approved)", async () => {
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

    // The article placeholder was created and then marked failed.
    expect(client.__chains.articles!.insert).toHaveBeenCalled();
    expect(client.__chains.articles!.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message: expect.stringContaining("schema mismatch"),
      }),
    );
    // The job was marked failed.
    const updateCalls = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0],
    );
    expect(updateCalls.some((u) => u.status === "failed")).toBe(true);
    // The idea status was NEVER touched.
    expect(client.__chains.article_ideas!.update).not.toHaveBeenCalled();
  });

  it("marks both article and job failed when the article placeholder insert fails", async () => {
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

    const updateCalls = client.__chains.article_jobs!.update.mock.calls.map(
      (c) => c[0],
    );
    expect(updateCalls.some((u) => u.status === "failed")).toBe(true);
    // No article was actually written, but the idea wasn't touched either.
    expect(client.__chains.article_ideas!.update).not.toHaveBeenCalled();
  });

  it("marks article + job failed when the post-AI article update fails", async () => {
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

  it("propagates non-Error throws as their string form", async () => {
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
  });
});
