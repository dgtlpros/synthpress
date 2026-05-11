import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("workflow", () => ({
  FatalError: class FatalError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "FatalError";
    }
  },
}));

vi.mock("@/services/article-generation-service", () => ({
  runGenerateArticleFromIdeaJob: vi.fn(),
}));

import { FatalError } from "workflow";
import { runGenerateArticleFromIdeaJob } from "@/services/article-generation-service";
import { generateArticleWorkflow } from "./generate-article";

const mockedRun = vi.mocked(runGenerateArticleFromIdeaJob);

beforeEach(() => {
  vi.clearAllMocks();
});

const successResult = {
  jobId: "job-1",
  articleId: "article-1",
  ideaId: "idea-1",
  status: "ready_for_review" as const,
  creditsUsed: 5,
  model: "claude-sonnet-4-6",
  promptTokens: 2200,
  completionTokens: 1800,
};

const baseInput = {
  jobId: "job-1",
  articleId: "article-1",
  blogId: "b1",
  teamId: "t1",
  ideaId: "idea-1",
  userId: "u1",
  triggerSource: "manual" as const,
};

describe("generateArticleWorkflow", () => {
  it("delegates to runGenerateArticleFromIdeaJob and returns its result", async () => {
    mockedRun.mockResolvedValueOnce(successResult);

    const result = await generateArticleWorkflow(baseInput);

    expect(result).toEqual(successResult);
    expect(mockedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        articleId: "article-1",
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        ideaId: "idea-1",
        triggerSource: "manual",
        jobInputPatch: expect.objectContaining({
          workflowName: "generateArticleWorkflow",
          workflowStartedAt: expect.any(String),
        }),
      }),
    );
  });

  it("includes autopilotRunId in the job input patch when provided", async () => {
    mockedRun.mockResolvedValueOnce(successResult);

    await generateArticleWorkflow({
      ...baseInput,
      triggerSource: "autopilot",
      autopilotRunId: "run-A",
    });

    expect(mockedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSource: "autopilot",
        jobInputPatch: expect.objectContaining({
          autopilotRunId: "run-A",
        }),
      }),
    );
  });

  it("omits autopilotRunId when not provided", async () => {
    mockedRun.mockResolvedValueOnce(successResult);

    await generateArticleWorkflow(baseInput);

    const patch = mockedRun.mock.calls[0]![0].jobInputPatch as Record<
      string,
      unknown
    >;
    expect(patch.autopilotRunId).toBeUndefined();
  });

  it("wraps step failures in a FatalError so the SDK does not retry", async () => {
    mockedRun.mockRejectedValue(new Error("schema mismatch"));

    const promise = generateArticleWorkflow(baseInput);

    await expect(promise).rejects.toBeInstanceOf(FatalError);
    await expect(generateArticleWorkflow(baseInput)).rejects.toThrow(
      /schema mismatch/,
    );
  });

  it("wraps non-Error throws as FatalError with their string form", async () => {
    mockedRun.mockRejectedValue("plain-string-failure");

    const promise = generateArticleWorkflow(baseInput);

    await expect(promise).rejects.toBeInstanceOf(FatalError);
    await expect(generateArticleWorkflow(baseInput)).rejects.toThrow(
      /plain-string-failure/,
    );
  });
});
