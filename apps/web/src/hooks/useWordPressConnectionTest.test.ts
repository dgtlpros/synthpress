import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/actions/wordpress-connection-test", () => ({
  testBlogWordPressConnection: vi.fn(),
}));

import { testBlogWordPressConnection } from "@/actions/wordpress-connection-test";
import { useWordPressConnectionTest } from "./useWordPressConnectionTest";

const mockedAction = vi.mocked(testBlogWordPressConnection);

const baseInput = { teamId: "t1", projectId: "p1", blogId: "b1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useWordPressConnectionTest", () => {
  it("starts in the idle phase with no result", () => {
    const { result } = renderHook(() => useWordPressConnectionTest(baseInput));
    expect(result.current.state.phase).toBe("idle");
    expect(result.current.state.result).toBeNull();
    expect(result.current.state.actionError).toBeNull();
    expect(result.current.isTesting).toBe(false);
  });

  it("calls the server action with team/project/blog ids", async () => {
    mockedAction.mockResolvedValue({
      data: {
        ok: true,
        siteUrl: "https://example.com",
        user: { id: 1, name: "Alice" },
        capabilities: {},
        warnings: [],
      },
      error: null,
    });
    const { result } = renderHook(() => useWordPressConnectionTest(baseInput));
    act(() => {
      result.current.test();
    });
    await waitFor(() => {
      expect(mockedAction).toHaveBeenCalledWith(baseInput);
    });
  });

  it("transitions to complete with the helper result on success", async () => {
    mockedAction.mockResolvedValue({
      data: {
        ok: true,
        siteUrl: "https://example.com",
        user: { id: 1, name: "Alice" },
        capabilities: { canUploadMedia: true },
        warnings: [],
      },
      error: null,
    });
    const { result } = renderHook(() => useWordPressConnectionTest(baseInput));
    act(() => {
      result.current.test();
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe("complete");
    });
    if (result.current.state.phase !== "complete") {
      throw new Error("expected complete phase");
    }
    expect(result.current.state.result.ok).toBe(true);
    expect(result.current.state.result.user?.name).toBe("Alice");
    expect(result.current.state.actionError).toBeNull();
  });

  it("transitions to complete with a helper-level failure (ok: false)", async () => {
    mockedAction.mockResolvedValue({
      data: {
        ok: false,
        siteUrl: "https://example.com",
        warnings: [],
        error: {
          code: "unauthorized",
          message: "WordPress rejected these credentials.",
        },
      },
      error: null,
    });
    const { result } = renderHook(() => useWordPressConnectionTest(baseInput));
    act(() => {
      result.current.test();
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe("complete");
    });
    if (result.current.state.phase !== "complete") {
      throw new Error("expected complete phase");
    }
    expect(result.current.state.result.ok).toBe(false);
    expect(result.current.state.result.error?.code).toBe("unauthorized");
  });

  it("transitions to action_error when the action layer rejects", async () => {
    mockedAction.mockResolvedValue({ data: null, error: "Blog not found." });
    const { result } = renderHook(() => useWordPressConnectionTest(baseInput));
    act(() => {
      result.current.test();
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe("action_error");
    });
    expect(result.current.state.actionError).toBe("Blog not found.");
    expect(result.current.state.result).toBeNull();
  });

  it("clears the panel when reset() is called", async () => {
    mockedAction.mockResolvedValue({
      data: {
        ok: true,
        siteUrl: "https://example.com",
        user: { id: 1 },
        capabilities: {},
        warnings: [],
      },
      error: null,
    });
    const { result } = renderHook(() => useWordPressConnectionTest(baseInput));
    act(() => {
      result.current.test();
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe("complete");
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.state.phase).toBe("idle");
    expect(result.current.state.result).toBeNull();
  });

  it("clears a previous result when a new test starts", async () => {
    mockedAction.mockResolvedValueOnce({
      data: {
        ok: false,
        siteUrl: "https://example.com",
        warnings: [],
        error: { code: "unauthorized", message: "..." },
      },
      error: null,
    });
    const { result } = renderHook(() => useWordPressConnectionTest(baseInput));
    act(() => {
      result.current.test();
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe("complete");
    });

    // Now kick off a second test with a deferred mock so we can
    // observe the in-flight `testing` phase.
    let resolveSecond: (
      v: Awaited<ReturnType<typeof testBlogWordPressConnection>>,
    ) => void = () => {};
    mockedAction.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveSecond = res;
        }),
    );
    act(() => {
      result.current.test();
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe("testing");
    });
    expect(result.current.state.result).toBeNull();

    act(() => {
      resolveSecond({
        data: {
          ok: true,
          siteUrl: "https://example.com",
          user: { id: 1 },
          capabilities: {},
          warnings: [],
        },
        error: null,
      });
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe("complete");
    });
  });
});
