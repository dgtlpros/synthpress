import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/article-generation", () => ({
  generateArticleFromIdea: vi.fn(),
}));

import { generateArticleFromIdea } from "@/actions/article-generation";
import { useGenerateArticleFromIdea } from "./useGenerateArticleFromIdea";

const mockedGenerate = vi.mocked(generateArticleFromIdea);

beforeEach(() => {
  refreshMock.mockClear();
  mockedGenerate.mockReset();
});

const baseProps = { teamId: "t1", projectId: "p1", blogId: "b1" };

describe("useGenerateArticleFromIdea", () => {
  it("calls the action with the idea id and refreshes on success", async () => {
    mockedGenerate.mockResolvedValue({
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

    const { result } = renderHook(() => useGenerateArticleFromIdea(baseProps));

    act(() => result.current.generate("i1"));

    await waitFor(() => {
      expect(mockedGenerate).toHaveBeenCalledWith("t1", "p1", "b1", "i1");
    });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
    expect(result.current.errorIdeaId).toBeNull();
    expect(result.current.lastResult).toEqual({
      jobId: "job-1",
      articleId: "article-1",
      ideaId: "i1",
      status: "pending",
      alreadyQueued: false,
      workflowRunId: "run-1",
    });
  });

  it("surfaces an error from the action and skips the refresh", async () => {
    mockedGenerate.mockResolvedValue({
      data: null,
      error: "Not enough synth tokens",
    });
    const { result } = renderHook(() => useGenerateArticleFromIdea(baseProps));

    act(() => result.current.generate("i1"));

    await waitFor(() => {
      expect(result.current.errorIdeaId).toBe("i1");
    });
    expect(result.current.errorMessage).toMatch(/synth tokens/i);
    expect(result.current.pendingIdeaId).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(result.current.lastResult).toBeNull();
  });

  it("invokes onSuccess after a successful generation", async () => {
    const onSuccess = vi.fn();
    mockedGenerate.mockResolvedValue({
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

    const { result } = renderHook(() =>
      useGenerateArticleFromIdea({ ...baseProps, onSuccess }),
    );

    act(() => result.current.generate("i1"));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ articleId: "article-1" }),
      );
    });
  });

  it("does not invoke onSuccess on error", async () => {
    const onSuccess = vi.fn();
    mockedGenerate.mockResolvedValue({ data: null, error: "boom" });

    const { result } = renderHook(() =>
      useGenerateArticleFromIdea({ ...baseProps, onSuccess }),
    );

    act(() => result.current.generate("i1"));

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("boom");
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("clears the error via resetError", async () => {
    mockedGenerate.mockResolvedValue({ data: null, error: "boom" });
    const { result } = renderHook(() => useGenerateArticleFromIdea(baseProps));

    act(() => result.current.generate("i1"));
    await waitFor(() => {
      expect(result.current.errorMessage).toBe("boom");
    });

    act(() => result.current.resetError());
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.errorIdeaId).toBeNull();
  });

  it("dispatches the JOB_QUEUED window event on success so the global tray refreshes immediately", async () => {
    mockedGenerate.mockResolvedValue({
      data: {
        jobId: "job-9",
        articleId: "article-9",
        ideaId: "i1",
        status: "pending",
        alreadyQueued: false,
        workflowRunId: "run-9",
      },
      error: null,
    });
    const listener = vi.fn();
    window.addEventListener("synthpress:active-jobs:queued", listener);

    const { result } = renderHook(() => useGenerateArticleFromIdea(baseProps));
    act(() => result.current.generate("i1"));

    await waitFor(() => {
      expect(listener).toHaveBeenCalledOnce();
    });
    const event = listener.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ jobId: "job-9", articleId: "article-9" });

    window.removeEventListener("synthpress:active-jobs:queued", listener);
  });

  it("does NOT dispatch the JOB_QUEUED event when the action errors", async () => {
    mockedGenerate.mockResolvedValue({ data: null, error: "boom" });
    const listener = vi.fn();
    window.addEventListener("synthpress:active-jobs:queued", listener);

    const { result } = renderHook(() => useGenerateArticleFromIdea(baseProps));
    act(() => result.current.generate("i1"));
    await waitFor(() => {
      expect(result.current.errorMessage).toBe("boom");
    });

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("synthpress:active-jobs:queued", listener);
  });
});
