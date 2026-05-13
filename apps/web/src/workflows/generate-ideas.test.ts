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
  runGenerateArticleIdeasJob: vi.fn(),
}));

import { FatalError } from "workflow";
import { runGenerateArticleIdeasJob } from "@/services/article-generation-service";
import { generateIdeasWorkflow } from "./generate-ideas";

const mockedRun = vi.mocked(runGenerateArticleIdeasJob);

beforeEach(() => {
  vi.clearAllMocks();
});

const successResult = {
  jobId: "job-1",
  ideas: [
    {
      id: "idea-1",
      title: "Idea A",
      blog_id: "b1",
      user_id: "u1",
      status: "generated",
    },
  ],
  creditsUsed: 1,
  promptTokens: 800,
  completionTokens: 600,
  model: "claude-haiku-4-5",
};

const baseInput = {
  jobId: "job-1",
  blogId: "b1",
  teamId: "t1",
  projectId: "p1",
  userId: "u1",
  triggerSource: "manual" as const,
  brief: "How to onboard SaaS customers",
  count: 10,
};

describe("generateIdeasWorkflow", () => {
  it("delegates to runGenerateArticleIdeasJob and returns its result", async () => {
    mockedRun.mockResolvedValueOnce(successResult as never);

    const result = await generateIdeasWorkflow(baseInput);

    expect(result).toEqual(successResult);
    expect(mockedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        blogId: "b1",
        teamId: "t1",
        userId: "u1",
        triggerSource: "manual",
        brief: "How to onboard SaaS customers",
        count: 10,
        jobInputPatch: expect.objectContaining({
          workflowName: "generateIdeasWorkflow",
          workflowStartedAt: expect.any(String),
        }),
      }),
    );
  });

  it("includes autopilotRunId in the job input patch when provided", async () => {
    mockedRun.mockResolvedValueOnce(successResult as never);

    await generateIdeasWorkflow({
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
    mockedRun.mockResolvedValueOnce(successResult as never);

    await generateIdeasWorkflow(baseInput);

    const patch = mockedRun.mock.calls[0]![0].jobInputPatch as Record<
      string,
      unknown
    >;
    expect(patch.autopilotRunId).toBeUndefined();
  });

  it("forwards null brief through unchanged (no AI seed)", async () => {
    mockedRun.mockResolvedValueOnce(successResult as never);

    await generateIdeasWorkflow({ ...baseInput, brief: null });

    expect(mockedRun).toHaveBeenCalledWith(
      expect.objectContaining({ brief: null }),
    );
  });

  it("wraps step failures in a FatalError so the SDK does not retry", async () => {
    mockedRun.mockRejectedValue(new Error("schema mismatch"));

    await expect(generateIdeasWorkflow(baseInput)).rejects.toBeInstanceOf(
      FatalError,
    );
    await expect(generateIdeasWorkflow(baseInput)).rejects.toThrow(
      /schema mismatch/,
    );
  });

  it("wraps non-Error throws as FatalError with their string form", async () => {
    mockedRun.mockRejectedValue("plain-string-failure");

    await expect(generateIdeasWorkflow(baseInput)).rejects.toBeInstanceOf(
      FatalError,
    );
    await expect(generateIdeasWorkflow(baseInput)).rejects.toThrow(
      /plain-string-failure/,
    );
  });
});
