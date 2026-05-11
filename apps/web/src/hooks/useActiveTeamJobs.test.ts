import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/actions/article-generation", () => ({
  getActiveTeamJobs: vi.fn(),
}));

import { getActiveTeamJobs } from "@/actions/article-generation";
import type { ActiveArticleJobRow } from "@/services/article-generation-service";
import { useActiveTeamJobs } from "./useActiveTeamJobs";

const mockedGet = vi.mocked(getActiveTeamJobs);

const STORAGE_KEY = "synthpress.activeJobs.dismissed.v1";

function makeJob(
  overrides: Partial<ActiveArticleJobRow> = {},
): ActiveArticleJobRow {
  return {
    id: "job-1",
    type: "generate_article",
    status: "processing",
    currentStep: "writing_article",
    errorMessage: null,
    output: null,
    createdAt: "2026-05-11T00:00:00Z",
    startedAt: "2026-05-11T00:00:01Z",
    completedAt: null,
    ideaId: "i1",
    blog: { id: "b1", name: "Blog", projectId: "p1", teamId: "t1" },
    article: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockedGet.mockReset();
  // Default fallback: any straggler poll tick that fires after a
  // test's `mockResolvedValueOnce` queue is exhausted gets a safe
  // empty payload, not `undefined`. Tests that need a specific
  // response stack `.mockResolvedValueOnce` calls on top.
  mockedGet.mockResolvedValue({ data: [], error: null });
  window.localStorage.clear();
  vi.useRealTimers();
  // Always start each test with the tab "visible" so a previous
  // test that toggled visibility doesn't leak into the next one.
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

describe("useActiveTeamJobs", () => {
  it("does an initial fetch and exposes loading → jobs", async () => {
    const job = makeJob();
    mockedGet.mockResolvedValueOnce({ data: [job], error: null });

    const { result } = renderHook(() =>
      useActiveTeamJobs({ disablePolling: true }),
    );

    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.jobs).toEqual([job]);
    expect(result.current.activeCount).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it("keeps the last good list when a subsequent fetch errors (no flicker)", async () => {
    const job = makeJob();
    mockedGet.mockResolvedValueOnce({ data: [job], error: null });
    // Always-fail fallback for the rest of the test — covers any
    // additional polls that fire while the assertions run.
    mockedGet.mockResolvedValue({ data: null, error: "transient blip" });

    const { result } = renderHook(() =>
      useActiveTeamJobs({ pollIntervalMs: 50 }),
    );
    await waitFor(() => {
      expect(result.current.jobs).toEqual([job]);
    });

    // Wait for the next poll tick to pick up the failing fixture.
    await waitFor(
      () => {
        expect(mockedGet).toHaveBeenCalledTimes(2);
      },
      { timeout: 500 },
    );

    await waitFor(() => {
      expect(result.current.error).toBe("transient blip");
    });
    // Last good list still rendering.
    expect(result.current.jobs).toEqual([job]);
  });

  it("filters out dismissed FINISHED jobs but keeps active jobs visible", async () => {
    const active = makeJob({ id: "active", status: "processing" });
    const finished = makeJob({
      id: "finished",
      status: "completed",
      currentStep: "completed",
      completedAt: "2026-05-11T00:01:00Z",
    });
    mockedGet.mockResolvedValue({ data: [active, finished], error: null });

    const { result } = renderHook(() =>
      useActiveTeamJobs({ disablePolling: true }),
    );

    await waitFor(() => {
      expect(result.current.jobs).toHaveLength(2);
    });

    act(() => {
      result.current.dismiss("finished");
    });
    await waitFor(() => {
      expect(result.current.jobs.map((j) => j.id)).toEqual(["active"]);
    });

    // Active job dismiss is a no-op even though we call it.
    act(() => {
      result.current.dismiss("active");
    });
    expect(result.current.jobs.map((j) => j.id)).toEqual(["active"]);
  });

  it("persists dismissed ids to localStorage and rehydrates them on mount", async () => {
    const finished = makeJob({
      id: "finished",
      status: "completed",
      currentStep: "completed",
    });
    mockedGet.mockResolvedValue({ data: [finished], error: null });

    const { result, unmount } = renderHook(() =>
      useActiveTeamJobs({ disablePolling: true }),
    );
    await waitFor(() => {
      expect(result.current.jobs).toHaveLength(1);
    });

    act(() => {
      result.current.dismiss("finished");
    });
    await waitFor(() => {
      expect(result.current.jobs).toHaveLength(0);
    });
    unmount();

    // localStorage should have the dismissed id.
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    expect(stored.map((e: { id: string }) => e.id)).toContain("finished");

    // Re-mount: the same finished job should still be filtered out.
    const { result: result2 } = renderHook(() =>
      useActiveTeamJobs({ disablePolling: true }),
    );
    await waitFor(() => {
      expect(result2.current.loading).toBe(false);
    });
    expect(result2.current.jobs).toHaveLength(0);
  });

  it("re-fires the fetch loop when polling is enabled", async () => {
    mockedGet.mockResolvedValue({ data: [], error: null });

    renderHook(() => useActiveTeamJobs({ pollIntervalMs: 30 }));

    await waitFor(
      () => {
        expect(mockedGet.mock.calls.length).toBeGreaterThanOrEqual(3);
      },
      { timeout: 500 },
    );
  });

  it("ignores localStorage entries that aren't well-formed", async () => {
    window.localStorage.setItem(STORAGE_KEY, "not-json");
    mockedGet.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() =>
      useActiveTeamJobs({ disablePolling: true }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Hook didn't crash. Internal dismissed list is empty.
    act(() => result.current.dismiss("nope"));
    expect(result.current.error).toBeNull();
  });

  it("ignores localStorage entries that aren't an array", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ id: "x", ts: 0 }),
    );
    mockedGet.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() =>
      useActiveTeamJobs({ disablePolling: true }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.jobs).toHaveLength(0);
  });

  it("filters out malformed entries inside an otherwise-valid stored array", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: "good-id", ts: Date.now() },
        { id: "missing-ts" },
        { ts: 12345 },
        "not-an-object",
        null,
      ]),
    );
    const finished = makeJob({
      id: "good-id",
      status: "completed",
      currentStep: "completed",
    });
    mockedGet.mockResolvedValue({ data: [finished], error: null });

    const { result } = renderHook(() =>
      useActiveTeamJobs({ disablePolling: true }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Only the well-formed entry was rehydrated, so `good-id` is
    // still hidden but malformed entries were silently dropped.
    expect(result.current.jobs).toHaveLength(0);
  });

  it("evicts dismissed entries older than the recent-window cutoff", async () => {
    const ancient = Date.now() - 1000 * 60 * 60 * 24; // 24h ago
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: "ancient", ts: ancient }]),
    );
    mockedGet.mockResolvedValue({ data: [], error: null });

    renderHook(() => useActiveTeamJobs({ disablePolling: true }));

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY) ?? "[]",
      );
      expect(stored).toEqual([]);
    });
  });

  it("pauses polling when the tab hides and resumes (with an immediate fetch) when it becomes visible again", async () => {
    mockedGet.mockResolvedValue({ data: [], error: null });

    renderHook(() => useActiveTeamJobs({ pollIntervalMs: 30 }));

    // Wait for the initial fetch + at least one poll tick.
    await waitFor(
      () => {
        expect(mockedGet.mock.calls.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 500 },
    );

    // Hide the tab → polling stops.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    const callsBeforeWait = mockedGet.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    // No additional polling happened while hidden (allow at most the
    // in-flight call before stop fired to finish).
    expect(mockedGet.mock.calls.length).toBeLessThanOrEqual(
      callsBeforeWait + 1,
    );

    // Show the tab again → an immediate refresh fires + polling resumes.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      expect(mockedGet.mock.calls.length).toBeGreaterThan(callsBeforeWait + 1);
    });
  });

  it("de-duplicates the dismissed list when the same job is dismissed twice", async () => {
    const finishedA = makeJob({
      id: "fin-A",
      status: "completed",
      currentStep: "completed",
    });
    const finishedB = makeJob({
      id: "fin-B",
      status: "completed",
      currentStep: "completed",
    });
    mockedGet.mockResolvedValue({
      data: [finishedA, finishedB],
      error: null,
    });

    const { result } = renderHook(() =>
      useActiveTeamJobs({ disablePolling: true }),
    );
    await waitFor(() => expect(result.current.jobs).toHaveLength(2));

    // Dismiss A, then B — exercises the `prev.filter` predicate when
    // there's already an entry in the stored array.
    act(() => result.current.dismiss("fin-A"));
    act(() => result.current.dismiss("fin-B"));
    // Dismiss A AGAIN — the filter has to walk over the existing
    // entry, which only happens when there's something to filter.
    act(() => result.current.dismiss("fin-A"));

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    const ids = stored.map((e: { id: string }) => e.id);
    // Both ids present, no duplicates, A re-promoted to the front.
    expect(ids).toEqual(["fin-A", "fin-B"]);
  });

  it("treats { data: null, error: null } as an empty list (defensive)", async () => {
    mockedGet.mockResolvedValueOnce({ data: null, error: null } as never);

    const { result } = renderHook(() =>
      useActiveTeamJobs({ disablePolling: true }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.jobs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("removes the visibility listener on unmount", async () => {
    mockedGet.mockResolvedValue({ data: [], error: null });
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() =>
      useActiveTeamJobs({ pollIntervalMs: 30 }),
    );
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    removeSpy.mockRestore();
  });

  it("dismiss is a no-op for an unknown job id (graceful)", async () => {
    mockedGet.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() =>
      useActiveTeamJobs({ disablePolling: true }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.dismiss("ghost");
    });
    // Stored anyway (we don't have visibility to know it's unknown
    // — the next mount would still filter on it if it ever shows up).
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    expect(stored.map((e: { id: string }) => e.id)).toContain("ghost");
  });
});
