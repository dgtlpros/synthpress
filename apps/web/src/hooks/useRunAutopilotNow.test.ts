import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/autopilot", () => ({
  runAutopilotNow: vi.fn(),
}));

import { runAutopilotNow } from "@/actions/autopilot";
import {
  describeRunResult,
  useRunAutopilotNow,
} from "./useRunAutopilotNow";

const mockedAction = vi.mocked(runAutopilotNow);

const baseProps = { teamId: "t1", projectId: "p1", blogId: "b1" };

beforeEach(() => {
  refreshMock.mockClear();
  mockedAction.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("describeRunResult — pure formatter", () => {
  it("formats completed with both ideas + articles", () => {
    const result = describeRunResult({
      runId: "r1",
      status: "completed",
      reason: null,
      ideasGenerated: 10,
      articleJobsStarted: 3,
    });
    expect(result.kind).toBe("success");
    expect(result.message).toContain("10 ideas");
    expect(result.message).toContain("3 article jobs");
  });

  it("formats completed with only articles (singular)", () => {
    const result = describeRunResult({
      runId: "r1",
      status: "completed",
      reason: null,
      ideasGenerated: 0,
      articleJobsStarted: 1,
    });
    expect(result.message).toBe("Autopilot started 1 article job.");
  });

  it("formats completed with only articles (plural)", () => {
    const result = describeRunResult({
      runId: "r1",
      status: "completed",
      reason: null,
      ideasGenerated: 0,
      articleJobsStarted: 4,
    });
    expect(result.message).toBe("Autopilot started 4 article jobs.");
  });

  it("formats completed with only ideas (singular)", () => {
    const result = describeRunResult({
      runId: "r1",
      status: "completed",
      reason: null,
      ideasGenerated: 1,
      articleJobsStarted: 0,
    });
    expect(result.message).toBe("Autopilot generated 1 idea.");
  });

  it("formats completed with only ideas (plural)", () => {
    const result = describeRunResult({
      runId: "r1",
      status: "completed",
      reason: null,
      ideasGenerated: 5,
      articleJobsStarted: 0,
    });
    expect(result.message).toBe("Autopilot generated 5 ideas.");
  });

  it("formats completed with no work as a generic success message", () => {
    const result = describeRunResult({
      runId: "r1",
      status: "completed",
      reason: null,
      ideasGenerated: 0,
      articleJobsStarted: 0,
    });
    expect(result.message).toBe("Autopilot ran successfully.");
  });

  it("formats skipped with a reason", () => {
    const result = describeRunResult({
      runId: "r1",
      status: "skipped",
      reason: "daily_article_cap_reached",
      ideasGenerated: 0,
      articleJobsStarted: 0,
    });
    expect(result.kind).toBe("success");
    expect(result.message).toContain("daily_article_cap_reached");
  });

  it("formats skipped without a reason", () => {
    const result = describeRunResult({
      runId: "r1",
      status: "skipped",
      reason: null,
      ideasGenerated: 0,
      articleJobsStarted: 0,
    });
    expect(result.message).toBe("Autopilot skipped this run.");
  });

  it("formats failed with a reason as an error", () => {
    const result = describeRunResult({
      runId: "r1",
      status: "failed",
      reason: "idea_generation_failed",
      ideasGenerated: 0,
      articleJobsStarted: 0,
    });
    expect(result.kind).toBe("error");
    expect(result.message).toContain("idea_generation_failed");
  });

  it("formats failed without a reason as a generic error", () => {
    const result = describeRunResult({
      runId: "r1",
      status: "failed",
      reason: null,
      ideasGenerated: 0,
      articleJobsStarted: 0,
    });
    expect(result.kind).toBe("error");
    expect(result.message).toBe("Autopilot failed.");
  });
});

describe("useRunAutopilotNow", () => {
  it("calls the action with the team/project/blog ids", async () => {
    mockedAction.mockResolvedValue({
      data: {
        runId: "run-1",
        status: "completed",
        reason: null,
        ideasGenerated: 0,
        articleJobsStarted: 1,
      },
      error: null,
    });
    const { result } = renderHook(() => useRunAutopilotNow(baseProps));

    act(() => result.current.run());

    await waitFor(() => {
      expect(mockedAction).toHaveBeenCalledWith("t1", "p1", "b1");
    });
  });

  it("flips isRunning while the action is in flight", async () => {
    let resolveAction: (
      value: Awaited<ReturnType<typeof runAutopilotNow>>,
    ) => void = () => {};
    mockedAction.mockReturnValue(
      new Promise((res) => {
        resolveAction = res;
      }),
    );
    const { result } = renderHook(() => useRunAutopilotNow(baseProps));

    act(() => result.current.run());
    expect(result.current.isRunning).toBe(true);

    act(() =>
      resolveAction({
        data: {
          runId: "run-1",
          status: "completed",
          reason: null,
          ideasGenerated: 0,
          articleJobsStarted: 1,
        },
        error: null,
      }),
    );
    await waitFor(() => {
      expect(result.current.isRunning).toBe(false);
    });
  });

  it("populates resultMessage + lastResult on success and refreshes the page", async () => {
    mockedAction.mockResolvedValue({
      data: {
        runId: "run-1",
        status: "completed",
        reason: null,
        ideasGenerated: 0,
        articleJobsStarted: 2,
      },
      error: null,
    });
    const { result } = renderHook(() => useRunAutopilotNow(baseProps));

    act(() => result.current.run());

    await waitFor(() => {
      expect(result.current.resultMessage).toEqual({
        kind: "success",
        message: "Autopilot started 2 article jobs.",
      });
    });
    expect(result.current.lastResult?.runId).toBe("run-1");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("invokes onSuccess with the action payload", async () => {
    const onSuccess = vi.fn();
    mockedAction.mockResolvedValue({
      data: {
        runId: "run-1",
        status: "completed",
        reason: null,
        ideasGenerated: 0,
        articleJobsStarted: 1,
      },
      error: null,
    });
    const { result } = renderHook(() =>
      useRunAutopilotNow({ ...baseProps, onSuccess }),
    );
    act(() => result.current.run());
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1" }),
      );
    });
  });

  it("renders an error message + does NOT refresh on action failure", async () => {
    mockedAction.mockResolvedValue({
      data: null,
      error: "Enable autopilot first.",
    });
    const { result } = renderHook(() => useRunAutopilotNow(baseProps));
    act(() => result.current.run());

    await waitFor(() => {
      expect(result.current.resultMessage).toEqual({
        kind: "error",
        message: "Enable autopilot first.",
      });
    });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(result.current.lastResult).toBeNull();
  });

  it("clears the result message via reset()", async () => {
    mockedAction.mockResolvedValue({
      data: null,
      error: "boom",
    });
    const { result } = renderHook(() => useRunAutopilotNow(baseProps));
    act(() => result.current.run());
    await waitFor(() => {
      expect(result.current.resultMessage).not.toBeNull();
    });

    act(() => result.current.reset());
    expect(result.current.resultMessage).toBeNull();
  });
});
