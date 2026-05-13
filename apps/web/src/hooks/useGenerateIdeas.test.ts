import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/article-generation", () => ({
  generateIdeasManual: vi.fn(),
}));

const dispatchSpy = vi.fn();
vi.mock("@/lib/active-jobs", () => ({
  dispatchJobQueuedEvent: (detail: unknown) => dispatchSpy(detail),
}));

import { generateIdeasManual } from "@/actions/article-generation";
import { useGenerateIdeas } from "./useGenerateIdeas";

const mockedGenerate = vi.mocked(generateIdeasManual);

beforeEach(() => {
  refreshMock.mockClear();
  dispatchSpy.mockClear();
  mockedGenerate.mockReset();
});

const baseProps = { teamId: "t1", projectId: "p1", blogId: "b1" };

const queuedResult = {
  jobId: "job-1",
  blogId: "b1",
  count: 10,
  status: "pending" as const,
  alreadyQueued: false,
  workflowRunId: "wf-run-1",
};

describe("useGenerateIdeas", () => {
  it("calls the action with empty input by default and refreshes on success", async () => {
    mockedGenerate.mockResolvedValue({ data: queuedResult, error: null });

    const { result } = renderHook(() => useGenerateIdeas(baseProps));

    act(() => result.current.generate());

    await waitFor(() => {
      expect(mockedGenerate).toHaveBeenCalledWith("t1", "p1", "b1", {});
    });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
    expect(result.current.generateError).toBeNull();
    expect(result.current.lastResult).toEqual(queuedResult);
  });

  it("dispatches the JOB_QUEUED event so the global tray refetches immediately", async () => {
    mockedGenerate.mockResolvedValue({ data: queuedResult, error: null });

    const { result } = renderHook(() => useGenerateIdeas(baseProps));

    act(() => result.current.generate());

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith({
        jobId: "job-1",
        articleId: null,
      });
    });
  });

  it("forwards a brief and count to the action", async () => {
    mockedGenerate.mockResolvedValue({
      data: { ...queuedResult, count: 5 },
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

  it("handles the alreadyQueued result without dispatching a duplicate event side-effect", async () => {
    mockedGenerate.mockResolvedValue({
      data: {
        jobId: "job-existing",
        blogId: "b1",
        count: 10,
        status: "processing",
        alreadyQueued: true,
        workflowRunId: null,
      },
      error: null,
    });

    const { result } = renderHook(() => useGenerateIdeas(baseProps));

    act(() => result.current.generate());

    // alreadyQueued still fires the event — the existing row may not
    // have been pulled into the tray yet, and the tray's listener is
    // idempotent (it just refetches).
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith({
        jobId: "job-existing",
        articleId: null,
      }),
    );
    expect(result.current.lastResult?.alreadyQueued).toBe(true);
  });

  it("surfaces an error from the action and skips the refresh + event", async () => {
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
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(result.current.lastResult).toBeNull();
  });

  it("invokes onSuccess after a successful queue+start round-trip", async () => {
    const onSuccess = vi.fn();
    mockedGenerate.mockResolvedValue({ data: queuedResult, error: null });

    const { result } = renderHook(() =>
      useGenerateIdeas({ ...baseProps, onSuccess }),
    );

    act(() => result.current.generate());

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: "job-1", alreadyQueued: false }),
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
