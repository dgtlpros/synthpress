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
        status: "ready_for_review",
        model: "claude-sonnet-4-6",
        creditsUsed: 5,
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
      status: "ready_for_review",
      model: "claude-sonnet-4-6",
      creditsUsed: 5,
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
        status: "ready_for_review",
        model: "claude-sonnet-4-6",
        creditsUsed: 5,
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
});
