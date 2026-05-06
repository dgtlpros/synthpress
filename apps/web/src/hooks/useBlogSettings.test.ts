import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockUpdateBlog = vi.fn();
const mockDeleteBlog = vi.fn();

vi.mock("@/actions/workspace", () => ({
  updateBlog: (...args: unknown[]) => mockUpdateBlog(...args),
  deleteBlog: (...args: unknown[]) => mockDeleteBlog(...args),
}));

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

import { useBlogSettings } from "./useBlogSettings";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useBlogSettings", () => {
  it("calls updateBlog and refreshes on successful rename", async () => {
    mockUpdateBlog.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() =>
      useBlogSettings({ teamId: "t1", projectId: "p1", blogId: "b1" }),
    );

    await act(async () => {
      result.current.renameBlog("New Name");
    });

    expect(mockUpdateBlog).toHaveBeenCalledWith("t1", "p1", "b1", { name: "New Name" });
    expect(mockRefresh).toHaveBeenCalledOnce();
    expect(result.current.renameError).toBeNull();
  });

  it("sets renameError on failure", async () => {
    mockUpdateBlog.mockResolvedValue({ data: null, error: "Blog name is required." });

    const { result } = renderHook(() =>
      useBlogSettings({ teamId: "t1", projectId: "p1", blogId: "b1" }),
    );

    await act(async () => {
      result.current.renameBlog("");
    });

    expect(result.current.renameError).toBe("Blog name is required.");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("calls deleteBlog and redirects on success", async () => {
    mockDeleteBlog.mockResolvedValue({
      data: { redirect: "/teams/t1/projects/p1/blogs" },
      error: null,
    });

    const { result } = renderHook(() =>
      useBlogSettings({ teamId: "t1", projectId: "p1", blogId: "b1" }),
    );

    await act(async () => {
      result.current.deleteBlog();
    });

    expect(mockDeleteBlog).toHaveBeenCalledWith("t1", "p1", "b1");
    expect(mockPush).toHaveBeenCalledWith("/teams/t1/projects/p1/blogs");
  });

  it("sets deleteError on delete failure", async () => {
    mockDeleteBlog.mockResolvedValue({ data: null, error: "not_a_member" });

    const { result } = renderHook(() =>
      useBlogSettings({ teamId: "t1", projectId: "p1", blogId: "b1" }),
    );

    await act(async () => {
      result.current.deleteBlog();
    });

    expect(result.current.deleteError).toBe("not_a_member");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("uses fallback URL when result.data has no redirect", async () => {
    mockDeleteBlog.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() =>
      useBlogSettings({ teamId: "t1", projectId: "p1", blogId: "b1" }),
    );

    await act(async () => {
      result.current.deleteBlog();
    });

    expect(mockPush).toHaveBeenCalledWith("/teams/t1/projects/p1/blogs");
  });
});
