import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/articles", () => ({
  updateArticle: vi.fn(),
}));

import { updateArticle } from "@/actions/articles";
import { useArticleEdit, type ArticleEditFormValue } from "./useArticleEdit";

const mockedUpdate = vi.mocked(updateArticle);

const initialValue: ArticleEditFormValue = {
  title: "Initial title",
  slug: "initial-slug",
  excerpt: "Initial excerpt",
  metaDescription: "Initial meta description",
  targetKeyword: "initial",
  contentMarkdown: "Initial body.",
};

const baseProps = {
  teamId: "t1",
  projectId: "p1",
  blogId: "b1",
  articleId: "a1",
  initialValue,
};

beforeEach(() => {
  refreshMock.mockClear();
  mockedUpdate.mockReset();
});

describe("useArticleEdit", () => {
  it("starts in read mode with the initial value", () => {
    const { result } = renderHook(() => useArticleEdit(baseProps));
    expect(result.current.isEditing).toBe(false);
    expect(result.current.value).toEqual(initialValue);
  });

  it("enters edit mode and resets the form to the initial value", () => {
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => {
      result.current.setField("title", "user typed something");
    });
    expect(result.current.value.title).toBe("user typed something");

    act(() => result.current.enterEdit());
    expect(result.current.isEditing).toBe(true);
    expect(result.current.value).toEqual(initialValue);
  });

  it("cancelEdit exits edit mode and resets the form", () => {
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() => result.current.setField("title", "X"));
    act(() => result.current.cancelEdit());

    expect(result.current.isEditing).toBe(false);
    expect(result.current.value).toEqual(initialValue);
  });

  it("setField updates only the targeted key", () => {
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.setField("excerpt", "new excerpt"));
    expect(result.current.value.excerpt).toBe("new excerpt");
    expect(result.current.value.title).toBe(initialValue.title);
  });

  it("calls the action with trimmed/null-coalesced fields on save (mixed)", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() => {
      result.current.setField("title", "  Edited title  ");
      result.current.setField("slug", "   ");
      result.current.setField("excerpt", "");
      result.current.setField("metaDescription", "  meta  ");
      result.current.setField("targetKeyword", "  kw  ");
      result.current.setField("contentMarkdown", "  body.  ");
    });

    act(() => result.current.save());

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("t1", "p1", "b1", "a1", {
        // title is NOT trimmed at the boundary — the service does the trim;
        // the hook just collapses other blanks to null.
        title: "  Edited title  ",
        slug: null,
        excerpt: null,
        metaDescription: "meta",
        targetKeyword: "kw",
        contentMarkdown: "body.",
      });
    });
  });

  it("collapses every blank optional field to null", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() =>
      useArticleEdit({
        ...baseProps,
        initialValue: {
          title: "Title",
          slug: "  ",
          excerpt: "",
          metaDescription: "   ",
          targetKeyword: "",
          contentMarkdown: "  ",
        },
      }),
    );
    act(() => result.current.enterEdit());
    act(() => result.current.save());

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("t1", "p1", "b1", "a1", {
        title: "Title",
        slug: null,
        excerpt: null,
        metaDescription: null,
        targetKeyword: null,
        contentMarkdown: null,
      });
    });
  });

  it("preserves non-blank optional fields", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() =>
      useArticleEdit({
        ...baseProps,
        initialValue: {
          title: "Title",
          slug: "the-slug",
          excerpt: "An excerpt.",
          metaDescription: "A meta.",
          targetKeyword: "kw",
          contentMarkdown: "Body.",
        },
      }),
    );
    act(() => result.current.enterEdit());
    act(() => result.current.save());

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("t1", "p1", "b1", "a1", {
        title: "Title",
        slug: "the-slug",
        excerpt: "An excerpt.",
        metaDescription: "A meta.",
        targetKeyword: "kw",
        contentMarkdown: "Body.",
      });
    });
  });

  it("exits edit mode + refreshes the route on a successful save", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());

    act(() => result.current.save());

    await waitFor(() => {
      expect(result.current.isEditing).toBe(false);
    });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
    expect(result.current.isSaving).toBe(false);
    expect(result.current.saveError).toBeNull();
  });

  it("invokes onSaved with the action result", async () => {
    const onSaved = vi.fn();
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() =>
      useArticleEdit({ ...baseProps, onSaved }),
    );

    act(() => result.current.enterEdit());
    act(() => result.current.save());

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({
        articleId: "a1",
        status: "ready_for_review",
      });
    });
  });

  it("surfaces save errors and stays in edit mode", async () => {
    mockedUpdate.mockResolvedValue({
      data: null,
      error: "Title is required.",
    });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());

    act(() => result.current.save());

    await waitFor(() => {
      expect(result.current.saveError).toBe("Title is required.");
    });
    expect(result.current.isEditing).toBe(true);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("clears the save error via resetSaveError", async () => {
    mockedUpdate.mockResolvedValue({ data: null, error: "boom" });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() => result.current.save());
    await waitFor(() => {
      expect(result.current.saveError).toBe("boom");
    });

    act(() => result.current.resetSaveError());
    expect(result.current.saveError).toBeNull();
  });
});
