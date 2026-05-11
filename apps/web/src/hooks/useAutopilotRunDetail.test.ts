import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/actions/autopilot", () => ({
  getAutopilotRunDetail: vi.fn(),
}));

import { getAutopilotRunDetail } from "@/actions/autopilot";
import { useAutopilotRunDetail } from "./useAutopilotRunDetail";

const mockedFetch = vi.mocked(getAutopilotRunDetail);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("useAutopilotRunDetail", () => {
  it("does NOT fetch when runId is null (drawer closed)", () => {
    renderHook(() =>
      useAutopilotRunDetail({
        teamId: "t1",
        projectId: "p1",
        blogId: "b1",
        runId: null,
      }),
    );
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("returns idle state when runId is null", () => {
    const { result } = renderHook(() =>
      useAutopilotRunDetail({
        teamId: "t1",
        projectId: "p1",
        blogId: "b1",
        runId: null,
      }),
    );
    expect(result.current).toEqual({
      detail: null,
      isLoading: false,
      error: null,
    });
  });

  it("fires the action when runId becomes non-null and surfaces loading", async () => {
    let resolveFetch: (v: never) => void = () => {};
    mockedFetch.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveFetch = res as never;
        }),
    );

    const { result } = renderHook(() =>
      useAutopilotRunDetail({
        teamId: "t1",
        projectId: "p1",
        blogId: "b1",
        runId: "run-1",
      }),
    );

    expect(mockedFetch).toHaveBeenCalledWith("t1", "p1", "b1", "run-1");
    expect(result.current.isLoading).toBe(true);
    expect(result.current.detail).toBeNull();
    expect(result.current.error).toBeNull();

    await act(async () => {
      resolveFetch({
        data: { run: { id: "run-1" }, jobs: [], articles: [], ideas: [] },
        error: null,
      } as never);
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.detail).toMatchObject({ run: { id: "run-1" } });
  });

  it("surfaces server-action errors as `error`", async () => {
    mockedFetch.mockResolvedValueOnce({ data: null, error: "Run not found." });

    const { result } = renderHook(() =>
      useAutopilotRunDetail({
        teamId: "t1",
        projectId: "p1",
        blogId: "b1",
        runId: "missing",
      }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toBe("Run not found.");
    expect(result.current.detail).toBeNull();
  });

  it("re-fetches when runId changes (drawer switches between runs)", async () => {
    mockedFetch
      .mockResolvedValueOnce({
        data: { run: { id: "r1" }, jobs: [], articles: [], ideas: [] } as never,
        error: null,
      })
      .mockResolvedValueOnce({
        data: { run: { id: "r2" }, jobs: [], articles: [], ideas: [] } as never,
        error: null,
      });

    const { result, rerender } = renderHook(
      ({ runId }) =>
        useAutopilotRunDetail({
          teamId: "t1",
          projectId: "p1",
          blogId: "b1",
          runId,
        }),
      { initialProps: { runId: "r1" as string | null } },
    );

    await waitFor(() => {
      expect(result.current.detail).toMatchObject({ run: { id: "r1" } });
    });

    rerender({ runId: "r2" });
    await waitFor(() => {
      expect(result.current.detail).toMatchObject({ run: { id: "r2" } });
    });
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("resets state when runId returns to null (drawer closes)", async () => {
    mockedFetch.mockResolvedValueOnce({
      data: { run: { id: "r1" }, jobs: [], articles: [], ideas: [] } as never,
      error: null,
    });

    const { result, rerender } = renderHook(
      ({ runId }) =>
        useAutopilotRunDetail({
          teamId: "t1",
          projectId: "p1",
          blogId: "b1",
          runId,
        }),
      { initialProps: { runId: "r1" as string | null } },
    );

    await waitFor(() => {
      expect(result.current.detail).toMatchObject({ run: { id: "r1" } });
    });

    rerender({ runId: null });
    expect(result.current.detail).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("ignores a stale resolve after the user switched to a different run", async () => {
    // Resolve the second fetch first, then the first. The cancelled
    // flag inside the hook means the first resolve is dropped on
    // the floor.
    let resolveFirst: (v: never) => void = () => {};
    let resolveSecond: (v: never) => void = () => {};
    mockedFetch
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveFirst = res as never;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveSecond = res as never;
          }),
      );

    const { result, rerender } = renderHook(
      ({ runId }) =>
        useAutopilotRunDetail({
          teamId: "t1",
          projectId: "p1",
          blogId: "b1",
          runId,
        }),
      { initialProps: { runId: "r1" as string | null } },
    );

    rerender({ runId: "r2" });

    await act(async () => {
      resolveSecond({
        data: { run: { id: "r2" }, jobs: [], articles: [], ideas: [] },
        error: null,
      } as never);
    });
    await act(async () => {
      // Stale resolve for the first id — should be ignored.
      resolveFirst({
        data: { run: { id: "r1" }, jobs: [], articles: [], ideas: [] },
        error: null,
      } as never);
    });

    expect(result.current.detail).toMatchObject({ run: { id: "r2" } });
  });
});
