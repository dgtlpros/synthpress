import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/article-generation", () => ({
  generateIdeasManual: vi.fn(),
}));

import { generateIdeasManual } from "@/actions/article-generation";
import { useGenerateIdeas } from "./useGenerateIdeas";

const mockedGenerate = vi.mocked(generateIdeasManual);

beforeEach(() => {
  refreshMock.mockClear();
  mockedGenerate.mockReset();
});

const baseProps = { teamId: "t1", projectId: "p1", blogId: "b1" };

describe("useGenerateIdeas", () => {
  it("calls the action with empty input by default and refreshes on success", async () => {
    mockedGenerate.mockResolvedValue({
      data: {
        jobId: "job-1",
        creditsUsed: 1,
        model: "claude-haiku-4-5",
        ideasGenerated: 10,
      },
      error: null,
    });

    const { result } = renderHook(() => useGenerateIdeas(baseProps));

    act(() => result.current.generate());

    await waitFor(() => {
      expect(mockedGenerate).toHaveBeenCalledWith("t1", "p1", "b1", {});
    });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
    expect(result.current.generateError).toBeNull();
    expect(result.current.lastResult).toEqual({
      jobId: "job-1",
      creditsUsed: 1,
      model: "claude-haiku-4-5",
      ideasGenerated: 10,
    });
  });

  it("forwards a brief and count to the action", async () => {
    mockedGenerate.mockResolvedValue({
      data: {
        jobId: "job-1",
        creditsUsed: 1,
        model: "claude-haiku-4-5",
        ideasGenerated: 5,
      },
      error: null,
    });

    const { result } = renderHook(() => useGenerateIdeas(baseProps));

    act(() => result.current.generate({ brief: "AI agents", count: 5 }));

    await waitFor(() => {
      expect(mockedGenerate).toHaveBeenCalledWith("t1", "p1", "b1", {
        brief: "AI agents",
        count: 5,
      });
    });
  });

  it("surfaces an error from the action and skips the refresh", async () => {
    mockedGenerate.mockResolvedValue({
      data: null,
      error: "Not enough synth tokens",
    });
    const { result } = renderHook(() => useGenerateIdeas(baseProps));

    act(() => result.current.generate());

    await waitFor(() => {
      expect(result.current.generateError).toBe("Not enough synth tokens");
    });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(result.current.lastResult).toBeNull();
  });

  it("invokes onSuccess after a successful generation", async () => {
    const onSuccess = vi.fn();
    mockedGenerate.mockResolvedValue({
      data: {
        jobId: "job-1",
        creditsUsed: 1,
        model: "claude-haiku-4-5",
        ideasGenerated: 7,
      },
      error: null,
    });

    const { result } = renderHook(() =>
      useGenerateIdeas({ ...baseProps, onSuccess }),
    );

    act(() => result.current.generate());

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ ideasGenerated: 7 }),
      );
    });
  });

  it("does not invoke onSuccess on error", async () => {
    const onSuccess = vi.fn();
    mockedGenerate.mockResolvedValue({
      data: null,
      error: "boom",
    });

    const { result } = renderHook(() =>
      useGenerateIdeas({ ...baseProps, onSuccess }),
    );

    act(() => result.current.generate());

    await waitFor(() => {
      expect(result.current.generateError).toBe("boom");
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("clears the error via resetError", async () => {
    mockedGenerate.mockResolvedValue({ data: null, error: "boom" });
    const { result } = renderHook(() => useGenerateIdeas(baseProps));

    act(() => result.current.generate());
    await waitFor(() => {
      expect(result.current.generateError).toBe("boom");
    });

    act(() => result.current.resetError());
    expect(result.current.generateError).toBeNull();
  });
});
