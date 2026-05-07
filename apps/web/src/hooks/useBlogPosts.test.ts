import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/workspace", () => ({
  createPost: vi.fn(),
}));

import { createPost } from "@/actions/workspace";
import { useBlogPosts } from "./useBlogPosts";

const mockedCreatePost = vi.mocked(createPost);

beforeEach(() => {
  refreshMock.mockClear();
  mockedCreatePost.mockReset();
});

describe("useBlogPosts", () => {
  it("calls createPost and refreshes the router on success", async () => {
    mockedCreatePost.mockResolvedValue({ data: { id: "p1" }, error: null });
    const { result } = renderHook(() =>
      useBlogPosts({ teamId: "t1", projectId: "p1", blogId: "b1" }),
    );

    act(() => {
      result.current.createPost({ title: "Hello" });
    });

    await waitFor(() => {
      expect(mockedCreatePost).toHaveBeenCalledWith("t1", "p1", "b1", {
        title: "Hello",
      });
    });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
    expect(result.current.createError).toBeNull();
  });

  it("surfaces an error from the server action", async () => {
    mockedCreatePost.mockResolvedValue({
      data: null,
      error: "Title too long.",
    });
    const { result } = renderHook(() =>
      useBlogPosts({ teamId: "t1", projectId: "p1", blogId: "b1" }),
    );

    act(() => {
      result.current.createPost({ title: "x" });
    });

    await waitFor(() => {
      expect(result.current.createError).toBe("Title too long.");
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
