import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/workspace", () => ({
  updateBlog: vi.fn(),
}));

import { updateBlog } from "@/actions/workspace";
import { useWordPressConnection } from "./useWordPressConnection";

const mockedUpdate = vi.mocked(updateBlog);

beforeEach(() => {
  refreshMock.mockClear();
  mockedUpdate.mockReset();
});

describe("useWordPressConnection", () => {
  it("connects with full credentials and refreshes", async () => {
    mockedUpdate.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() =>
      useWordPressConnection({ teamId: "t1", projectId: "p1", blogId: "b1" }),
    );
    act(() => {
      result.current.connect({
        wpUrl: "https://x.com",
        wpUsername: "u",
        wpAppPassword: "p",
      });
    });
    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("t1", "p1", "b1", {
        connection: {
          wpUrl: "https://x.com",
          wpUsername: "u",
          wpAppPassword: "p",
        },
      });
    });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("disconnects by sending nulls", async () => {
    mockedUpdate.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() =>
      useWordPressConnection({ teamId: "t1", projectId: "p1", blogId: "b1" }),
    );
    act(() => {
      result.current.disconnect();
    });
    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("t1", "p1", "b1", {
        connection: { wpUrl: null, wpUsername: null, wpAppPassword: null },
      });
    });
  });

  it("surfaces errors", async () => {
    mockedUpdate.mockResolvedValue({ data: null, error: "Forbidden." });
    const { result } = renderHook(() =>
      useWordPressConnection({ teamId: "t1", projectId: "p1", blogId: "b1" }),
    );
    act(() => {
      result.current.connect({
        wpUrl: "https://x.com",
        wpUsername: "u",
        wpAppPassword: "p",
      });
    });
    await waitFor(() => {
      expect(result.current.error).toBe("Forbidden.");
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("surfaces a disconnect error and skips refresh", async () => {
    mockedUpdate.mockResolvedValue({ data: null, error: "Permission denied." });
    const { result } = renderHook(() =>
      useWordPressConnection({ teamId: "t1", projectId: "p1", blogId: "b1" }),
    );
    act(() => {
      result.current.disconnect();
    });
    await waitFor(() => {
      expect(result.current.error).toBe("Permission denied.");
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
