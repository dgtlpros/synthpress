import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/services/team-policy-service", () => {
  class TeamPermissionError extends Error {
    code: "not_a_member" | "forbidden";
    action: string;
    role: string | null;
    constructor(
      code: "not_a_member" | "forbidden",
      action: string,
      role: string | null,
    ) {
      super(`Forbidden: cannot ${action}`);
      this.code = code;
      this.action = action;
      this.role = role;
    }
  }
  return {
    assertCan: vi.fn(),
    TeamPermissionError,
  };
});

vi.mock("@/services/article-generation-service", () => ({
  generateArticleIdeas: vi.fn(),
  queueGenerateArticleFromIdea: vi.fn(),
  updateArticleIdeaStatus: vi.fn(),
}));

vi.mock("workflow/api", () => ({
  start: vi.fn(),
}));

vi.mock("@/workflows/generate-article", () => ({
  generateArticleWorkflow: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { start } from "workflow/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import {
  generateArticleIdeas,
  queueGenerateArticleFromIdea,
  updateArticleIdeaStatus,
} from "@/services/article-generation-service";
import { generateArticleWorkflow } from "@/workflows/generate-article";
import {
  generateArticleFromIdea,
  generateIdeasManual,
  updateIdeaStatus,
} from "./article-generation";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdmin = vi.mocked(createAdminClient);
const mockedAssertCan = vi.mocked(assertCan);
const mockedGenerateArticleIdeas = vi.mocked(generateArticleIdeas);
const mockedQueueGenerateArticle = vi.mocked(queueGenerateArticleFromIdea);
const mockedUpdateArticleIdeaStatus = vi.mocked(updateArticleIdeaStatus);
const mockedRevalidatePath = vi.mocked(revalidatePath);
const mockedStart = vi.mocked(start);

function makeAuthedClient(user: { id: string } | null = { id: "u1" }) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  };
}

interface BlogChain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
}

/**
 * Wires the admin client's `from("blogs")` lookup to a result. The
 * `updateIdeaStatus` action does this lookup before calling the
 * service helper so we need to control what it sees.
 */
function makeAdminWithBlog(blog: { id: string } | null): {
  client: { from: ReturnType<typeof vi.fn> };
  chain: BlogChain;
} {
  const chain: BlogChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: blog, error: null }),
  };
  return { client: { from: vi.fn(() => chain) }, chain };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(makeAuthedClient() as never);
  mockedCreateAdmin.mockReturnValue({} as never);
  mockedAssertCan.mockResolvedValue("owner" as never);
  mockedGenerateArticleIdeas.mockResolvedValue({
    jobId: "job-1",
    ideas: [
      { id: "i1", title: "A", blog_id: "b1", status: "generated" } as never,
      { id: "i2", title: "B", blog_id: "b1", status: "generated" } as never,
    ],
    creditsUsed: 1,
    promptTokens: 800,
    completionTokens: 600,
    model: "claude-haiku-4-5",
  });
});

describe("generateIdeasManual", () => {
  it("rejects briefs longer than the configured max", async () => {
    const result = await generateIdeasManual("t1", "p1", "b1", {
      brief: "x".repeat(2001),
    });
    expect(result.error).toMatch(/at most/);
    expect(mockedGenerateArticleIdeas).not.toHaveBeenCalled();
  });

  it("rejects out-of-range counts", async () => {
    const tooLow = await generateIdeasManual("t1", "p1", "b1", { count: 0 });
    expect(tooLow.error).toMatch(/between/);

    const tooHigh = await generateIdeasManual("t1", "p1", "b1", { count: 100 });
    expect(tooHigh.error).toMatch(/between/);

    const notFinite = await generateIdeasManual("t1", "p1", "b1", {
      count: Number.NaN,
    });
    expect(notFinite.error).toMatch(/between/);

    expect(mockedGenerateArticleIdeas).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    mockedCreateClient.mockResolvedValue(makeAuthedClient(null) as never);

    const result = await generateIdeasManual("t1", "p1", "b1");
    expect(result.error).toBe("You must be signed in.");
    expect(mockedAssertCan).not.toHaveBeenCalled();
    expect(mockedGenerateArticleIdeas).not.toHaveBeenCalled();
  });

  it("calls assertCan with the consume_team_tokens action", async () => {
    await generateIdeasManual("t1", "p1", "b1");

    expect(mockedAssertCan).toHaveBeenCalledWith(
      "t1",
      "u1",
      "consume_team_tokens",
      expect.anything(),
    );
  });

  it("calls generateArticleIdeas with triggerSource manual + admin client", async () => {
    await generateIdeasManual("t1", "p1", "b1", {
      brief: "How to ship faster",
      count: 5,
    });

    expect(mockedGenerateArticleIdeas).toHaveBeenCalledWith(
      expect.objectContaining({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        brief: "How to ship faster",
        count: 5,
        triggerSource: "manual",
        client: expect.anything(),
      }),
    );
  });

  it("returns a trimmed result on success and revalidates the relevant paths", async () => {
    const result = await generateIdeasManual("t1", "p1", "b1");

    expect(result).toEqual({
      data: {
        jobId: "job-1",
        creditsUsed: 1,
        model: "claude-haiku-4-5",
        ideasGenerated: 2,
      },
      error: null,
    });

    const calls = mockedRevalidatePath.mock.calls.map((c) => c[0]);
    expect(calls).toContain("/teams/t1/projects/p1/blogs/b1/ideas");
    expect(calls).toContain("/teams/t1/projects/p1/blogs/b1");
  });

  it("translates blog_not_found into a friendly error", async () => {
    mockedGenerateArticleIdeas.mockRejectedValueOnce(
      new Error("blog_not_found"),
    );

    const result = await generateIdeasManual("t1", "p1", "b1");
    expect(result.error).toBe("Blog not found.");
  });

  it("translates insufficient_tokens into a friendly error", async () => {
    mockedGenerateArticleIdeas.mockRejectedValueOnce(
      new Error("insufficient_tokens"),
    );

    const result = await generateIdeasManual("t1", "p1", "b1");
    expect(result.error).toMatch(/Not enough synth tokens/);
  });

  it("returns the TeamPermissionError code when the caller can't spend tokens", async () => {
    mockedAssertCan.mockRejectedValueOnce(
      new TeamPermissionError(
        "forbidden",
        "consume_team_tokens",
        "member" as never,
      ),
    );

    const result = await generateIdeasManual("t1", "p1", "b1");
    expect(result.error).toBe("forbidden");
  });

  it("falls back to a generic message for unknown errors", async () => {
    mockedGenerateArticleIdeas.mockRejectedValueOnce(new Error("network"));
    const result = await generateIdeasManual("t1", "p1", "b1");
    expect(result.error).toBe("network");
  });

  it("falls back to the default error message when something non-Error throws", async () => {
    mockedGenerateArticleIdeas.mockRejectedValueOnce("nope");
    const result = await generateIdeasManual("t1", "p1", "b1");
    expect(result.error).toBe("Could not generate ideas.");
  });
});

describe("updateIdeaStatus", () => {
  beforeEach(() => {
    mockedUpdateArticleIdeaStatus.mockResolvedValue({
      id: "i1",
      blog_id: "b1",
      status: "approved",
    } as never);
  });

  it("rejects statuses outside the manual review set", async () => {
    const result = await updateIdeaStatus(
      "t1",
      "p1",
      "b1",
      "i1",
      "generated" as never,
    );
    expect(result.error).toMatch(/approved.*rejected/i);
    expect(mockedAssertCan).not.toHaveBeenCalled();
    expect(mockedUpdateArticleIdeaStatus).not.toHaveBeenCalled();
  });

  it("rejects calls without an idea id", async () => {
    const result = await updateIdeaStatus("t1", "p1", "b1", "", "approved");
    expect(result.error).toBe("Idea id is required.");
  });

  it("rejects unauthenticated callers", async () => {
    mockedCreateClient.mockResolvedValue(makeAuthedClient(null) as never);

    const result = await updateIdeaStatus("t1", "p1", "b1", "i1", "approved");
    expect(result.error).toBe("You must be signed in.");
    expect(mockedAssertCan).not.toHaveBeenCalled();
    expect(mockedUpdateArticleIdeaStatus).not.toHaveBeenCalled();
  });

  it("checks manage_blog permission before doing any work", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    await updateIdeaStatus("t1", "p1", "b1", "i1", "approved");

    expect(mockedAssertCan).toHaveBeenCalledWith(
      "t1",
      "u1",
      "manage_blog",
      expect.anything(),
    );
  });

  it("returns Blog not found when the blog isn't in this project", async () => {
    const { client } = makeAdminWithBlog(null);
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await updateIdeaStatus("t1", "p1", "b1", "i1", "approved");
    expect(result.error).toBe("Blog not found.");
    expect(mockedUpdateArticleIdeaStatus).not.toHaveBeenCalled();
  });

  it("delegates to updateArticleIdeaStatus with the admin client", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    await updateIdeaStatus("t1", "p1", "b1", "i1", "rejected");

    expect(mockedUpdateArticleIdeaStatus).toHaveBeenCalledWith({
      ideaId: "i1",
      blogId: "b1",
      status: "rejected",
      client: expect.anything(),
    });
  });

  it("returns the new status and revalidates the relevant paths", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedUpdateArticleIdeaStatus.mockResolvedValueOnce({
      id: "i1",
      blog_id: "b1",
      status: "rejected",
    } as never);

    const result = await updateIdeaStatus("t1", "p1", "b1", "i1", "rejected");

    expect(result).toEqual({
      data: { ideaId: "i1", status: "rejected" },
      error: null,
    });
    const calls = mockedRevalidatePath.mock.calls.map((c) => c[0]);
    expect(calls).toContain("/teams/t1/projects/p1/blogs/b1/ideas");
    expect(calls).toContain("/teams/t1/projects/p1/blogs/b1");
  });

  it("translates idea_not_found into a friendly error", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedUpdateArticleIdeaStatus.mockRejectedValueOnce(
      new Error("idea_not_found"),
    );

    const result = await updateIdeaStatus("t1", "p1", "b1", "i1", "approved");
    expect(result.error).toBe("Idea not found.");
  });

  it("translates invalid_idea_status_transition errors into a friendly message", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedUpdateArticleIdeaStatus.mockRejectedValueOnce(
      new Error(
        "invalid_idea_status_transition:converted_to_article->approved",
      ),
    );

    const result = await updateIdeaStatus("t1", "p1", "b1", "i1", "approved");
    expect(result.error).toMatch(/can't be changed/i);
  });

  it("returns the TeamPermissionError code when the caller can't manage the blog", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedAssertCan.mockRejectedValueOnce(
      new TeamPermissionError("forbidden", "manage_blog", "member" as never),
    );

    const result = await updateIdeaStatus("t1", "p1", "b1", "i1", "approved");
    expect(result.error).toBe("forbidden");
  });

  it("propagates unknown service errors as-is", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedUpdateArticleIdeaStatus.mockRejectedValueOnce(new Error("network"));

    const result = await updateIdeaStatus("t1", "p1", "b1", "i1", "approved");
    expect(result.error).toBe("network");
  });

  it("falls back to the default error when something non-Error throws", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedUpdateArticleIdeaStatus.mockRejectedValueOnce("nope");

    const result = await updateIdeaStatus("t1", "p1", "b1", "i1", "approved");
    expect(result.error).toBe("Could not update idea.");
  });
});

describe("generateArticleFromIdea", () => {
  beforeEach(() => {
    mockedQueueGenerateArticle.mockResolvedValue({
      jobId: "job-1",
      articleId: "article-1",
      ideaId: "i1",
      status: "pending",
      alreadyQueued: false,
    } as never);
    mockedStart.mockResolvedValue({ id: "run-1" } as never);
  });

  it("rejects calls without an idea id", async () => {
    const result = await generateArticleFromIdea("t1", "p1", "b1", "");
    expect(result.error).toBe("Idea id is required.");
    expect(mockedQueueGenerateArticle).not.toHaveBeenCalled();
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    mockedCreateClient.mockResolvedValue(makeAuthedClient(null) as never);

    const result = await generateArticleFromIdea("t1", "p1", "b1", "i1");
    expect(result.error).toBe("You must be signed in.");
    expect(mockedAssertCan).not.toHaveBeenCalled();
    expect(mockedQueueGenerateArticle).not.toHaveBeenCalled();
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it("checks consume_team_tokens permission before doing any work", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    await generateArticleFromIdea("t1", "p1", "b1", "i1");

    expect(mockedAssertCan).toHaveBeenCalledWith(
      "t1",
      "u1",
      "consume_team_tokens",
      expect.anything(),
    );
  });

  it("returns Blog not found when the blog isn't in this project", async () => {
    const { client } = makeAdminWithBlog(null);
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await generateArticleFromIdea("t1", "p1", "b1", "i1");
    expect(result.error).toBe("Blog not found.");
    expect(mockedQueueGenerateArticle).not.toHaveBeenCalled();
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it("queues the durable job AND starts the workflow on first call", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    await generateArticleFromIdea("t1", "p1", "b1", "i1");

    expect(mockedQueueGenerateArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "i1",
        triggerSource: "manual",
        client: expect.anything(),
      }),
    );
    expect(mockedStart).toHaveBeenCalledWith(generateArticleWorkflow, [
      expect.objectContaining({
        jobId: "job-1",
        articleId: "article-1",
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "i1",
        triggerSource: "manual",
      }),
    ]);
  });

  it("returns the durable job/article ids and the workflow run id", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await generateArticleFromIdea("t1", "p1", "b1", "i1");

    expect(result).toEqual({
      data: {
        jobId: "job-1",
        articleId: "article-1",
        ideaId: "i1",
        status: "pending",
        alreadyQueued: false,
        workflowRunId: "run-1",
      },
      error: null,
    });
    const calls = mockedRevalidatePath.mock.calls.map((c) => c[0]);
    expect(calls).toContain("/teams/t1/projects/p1/blogs/b1/ideas");
    expect(calls).toContain("/teams/t1/projects/p1/blogs/b1");
    expect(calls).toContain("/teams/t1/projects/p1/blogs/b1/posts/article-1");
  });

  it("falls back to runId when the SDK exposes runId instead of id", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedStart.mockResolvedValueOnce({ runId: "run-2" } as never);

    const result = await generateArticleFromIdea("t1", "p1", "b1", "i1");
    expect(result.data?.workflowRunId).toBe("run-2");
  });

  it("returns workflowRunId=null when the SDK returns no id", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedStart.mockResolvedValueOnce({} as never);

    const result = await generateArticleFromIdea("t1", "p1", "b1", "i1");
    expect(result.data?.workflowRunId).toBeNull();
  });

  it("does NOT start a second workflow when a job is already queued for the idea", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedQueueGenerateArticle.mockResolvedValueOnce({
      jobId: "job-existing",
      articleId: "article-existing",
      ideaId: "i1",
      status: "processing",
      alreadyQueued: true,
    } as never);

    const result = await generateArticleFromIdea("t1", "p1", "b1", "i1");

    expect(mockedStart).not.toHaveBeenCalled();
    expect(result.data).toEqual({
      jobId: "job-existing",
      articleId: "article-existing",
      ideaId: "i1",
      status: "processing",
      alreadyQueued: true,
      workflowRunId: null,
    });
  });

  it("surfaces a friendly error when start() throws", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedStart.mockRejectedValueOnce(new Error("workflow runner offline"));

    const result = await generateArticleFromIdea("t1", "p1", "b1", "i1");

    expect(result.error).toMatch(
      /Could not start the article generation workflow/,
    );
    expect(result.error).toMatch(/workflow runner offline/);
  });

  it("falls back to a default message when start() throws a non-Error", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedStart.mockRejectedValueOnce("string-failure");

    const result = await generateArticleFromIdea("t1", "p1", "b1", "i1");

    expect(result.error).toMatch(
      /Could not start the article generation workflow/,
    );
    expect(result.error).toMatch(/Could not start workflow/);
  });

  it("translates idea_not_found into a friendly error", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedQueueGenerateArticle.mockRejectedValueOnce(
      new Error("idea_not_found"),
    );

    const result = await generateArticleFromIdea("t1", "p1", "b1", "i1");
    expect(result.error).toBe("Idea not found.");
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it("translates idea_not_approved into a friendly error", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedQueueGenerateArticle.mockRejectedValueOnce(
      new Error("idea_not_approved"),
    );

    const result = await generateArticleFromIdea("t1", "p1", "b1", "i1");
    expect(result.error).toMatch(/Only approved ideas/i);
  });

  it("translates blog_not_found into a friendly error", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedQueueGenerateArticle.mockRejectedValueOnce(
      new Error("blog_not_found"),
    );

    const result = await generateArticleFromIdea("t1", "p1", "b1", "i1");
    expect(result.error).toBe("Blog not found.");
  });

  it("returns the TeamPermissionError code when the caller can't spend tokens", async () => {
    mockedAssertCan.mockRejectedValueOnce(
      new TeamPermissionError(
        "forbidden",
        "consume_team_tokens",
        "member" as never,
      ),
    );

    const result = await generateArticleFromIdea("t1", "p1", "b1", "i1");
    expect(result.error).toBe("forbidden");
  });

  it("propagates unknown queue errors as-is", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedQueueGenerateArticle.mockRejectedValueOnce(new Error("network"));

    const result = await generateArticleFromIdea("t1", "p1", "b1", "i1");
    expect(result.error).toBe("network");
  });

  it("falls back to the default error when something non-Error throws", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedQueueGenerateArticle.mockRejectedValueOnce("nope");

    const result = await generateArticleFromIdea("t1", "p1", "b1", "i1");
    expect(result.error).toBe("Could not generate article.");
  });
});
