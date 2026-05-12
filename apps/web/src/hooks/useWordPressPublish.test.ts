import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/articles", () => ({
  sendArticleToWordPressDraft: vi.fn(),
  updateArticleWordPressDraftAction: vi.fn(),
  publishArticleToWordPressLiveAction: vi.fn(),
  clearArticleWordPressLink: vi.fn(),
}));

import {
  clearArticleWordPressLink,
  publishArticleToWordPressLiveAction,
  sendArticleToWordPressDraft,
  updateArticleWordPressDraftAction,
} from "@/actions/articles";
import { PUBLISH_ARTICLE_ERROR_COPY } from "@/lib/wordpress-publish-error-copy";
import { useWordPressPublish } from "./useWordPressPublish";

const mockedSend = vi.mocked(sendArticleToWordPressDraft);
const mockedUpdate = vi.mocked(updateArticleWordPressDraftAction);
const mockedPublish = vi.mocked(publishArticleToWordPressLiveAction);
const mockedClear = vi.mocked(clearArticleWordPressLink);

const baseProps = {
  teamId: "t1",
  projectId: "p1",
  blogId: "b1",
  articleId: "a1",
};

beforeEach(() => {
  refreshMock.mockClear();
  mockedSend.mockReset();
  mockedUpdate.mockReset();
  mockedPublish.mockReset();
  mockedClear.mockReset();
});

describe("useWordPressPublish", () => {
  it("starts idle with no error and no result", () => {
    const { result } = renderHook(() => useWordPressPublish(baseProps));
    expect(result.current.isSending).toBe(false);
    expect(result.current.isUpdating).toBe(false);
    expect(result.current.isPublishing).toBe(false);
    expect(result.current.isClearing).toBe(false);
    expect(result.current.pendingAction).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.errorIsRemoteMissing).toBe(false);
    expect(result.current.lastResult).toBeNull();
  });

  // --------------------------------------------------------------
  // send (create new draft)
  // --------------------------------------------------------------

  describe("send", () => {
    it("calls the action with the team/project/blog/article ids", async () => {
      mockedSend.mockResolvedValue({
        data: { articleId: "a1", wpPostId: 1, wpPostUrl: "https://x.com/?p=1" },
        error: null,
      });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.send());
      await waitFor(() =>
        expect(mockedSend).toHaveBeenCalledWith("t1", "p1", "b1", "a1"),
      );
    });

    it("captures the success result and refreshes the route", async () => {
      mockedSend.mockResolvedValue({
        data: { articleId: "a1", wpPostId: 7, wpPostUrl: "https://x.com/?p=7" },
        error: null,
      });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.send());

      await waitFor(() =>
        expect(result.current.lastResult).toEqual({
          articleId: "a1",
          wpPostId: 7,
          wpPostUrl: "https://x.com/?p=7",
        }),
      );
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(result.current.pendingAction).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it("surfaces action errors and does not refresh on failure", async () => {
      mockedSend.mockResolvedValue({
        data: null,
        error: "Connect a WordPress site first.",
      });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.send());

      await waitFor(() =>
        expect(result.current.error).toBe("Connect a WordPress site first."),
      );
      expect(result.current.lastResult).toBeNull();
      expect(refreshMock).not.toHaveBeenCalled();
      expect(result.current.isSending).toBe(false);
    });

    it("invokes onSuccess with the action result + label", async () => {
      const onSuccess = vi.fn();
      mockedSend.mockResolvedValue({
        data: { articleId: "a1", wpPostId: 9, wpPostUrl: null },
        error: null,
      });
      const { result } = renderHook(() =>
        useWordPressPublish({ ...baseProps, onSuccess }),
      );

      act(() => result.current.send());

      await waitFor(() =>
        expect(onSuccess).toHaveBeenCalledWith(
          { articleId: "a1", wpPostId: 9, wpPostUrl: null },
          "send",
        ),
      );
    });

    it("clears a previous error before each new send attempt", async () => {
      mockedSend
        .mockResolvedValueOnce({ data: null, error: "boom" })
        .mockResolvedValueOnce({
          data: { articleId: "a1", wpPostId: 1, wpPostUrl: null },
          error: null,
        });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.send());
      await waitFor(() => expect(result.current.error).toBe("boom"));

      act(() => result.current.send());
      await waitFor(() => expect(result.current.error).toBeNull());
      await waitFor(() => expect(result.current.lastResult?.wpPostId).toBe(1));
    });

    it("clears the error via resetError", async () => {
      mockedSend.mockResolvedValue({ data: null, error: "oops" });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.send());
      await waitFor(() => expect(result.current.error).toBe("oops"));

      act(() => result.current.resetError());
      expect(result.current.error).toBeNull();
    });
  });

  // --------------------------------------------------------------
  // updateDraft (PUT status="draft")
  // --------------------------------------------------------------

  describe("updateDraft", () => {
    it("calls the update action with the right ids", async () => {
      mockedUpdate.mockResolvedValue({
        data: {
          articleId: "a1",
          wpPostId: 7,
          wpPostUrl: "https://x.com/?p=7",
          wpStatus: "draft",
          publishedLocally: false,
        },
        error: null,
      });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.updateDraft());
      await waitFor(() =>
        expect(mockedUpdate).toHaveBeenCalledWith("t1", "p1", "b1", "a1"),
      );
    });

    it("flips isUpdating while in flight then back to idle", async () => {
      let resolve!: (v: {
        data: {
          articleId: string;
          wpPostId: number;
          wpPostUrl: string | null;
          wpStatus: "draft" | "publish";
          publishedLocally: boolean;
        } | null;
        error: string | null;
      }) => void;
      mockedUpdate.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }) as never,
      );
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.updateDraft());
      await waitFor(() => expect(result.current.isUpdating).toBe(true));
      expect(result.current.pendingAction).toBe("update");

      await act(async () => {
        resolve({
          data: {
            articleId: "a1",
            wpPostId: 7,
            wpPostUrl: "https://x.com/?p=7",
            wpStatus: "draft",
            publishedLocally: false,
          },
          error: null,
        });
      });
      await waitFor(() => expect(result.current.isUpdating).toBe(false));
    });

    it("surfaces update errors", async () => {
      mockedUpdate.mockResolvedValue({
        data: null,
        error: "WP rejected.",
      });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.updateDraft());
      await waitFor(() => expect(result.current.error).toBe("WP rejected."));
    });

    it("flags errorIsRemoteMissing for the wp_post_not_found copy", async () => {
      mockedUpdate.mockResolvedValue({
        data: null,
        error: PUBLISH_ARTICLE_ERROR_COPY.wp_post_not_found,
      });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.updateDraft());
      await waitFor(() =>
        expect(result.current.errorIsRemoteMissing).toBe(true),
      );
    });

    it("does NOT flag errorIsRemoteMissing for other errors", async () => {
      mockedUpdate.mockResolvedValue({ data: null, error: "WP rejected." });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.updateDraft());
      await waitFor(() => expect(result.current.error).toBe("WP rejected."));
      expect(result.current.errorIsRemoteMissing).toBe(false);
    });
  });

  // --------------------------------------------------------------
  // publishLive (PUT status="publish")
  // --------------------------------------------------------------

  describe("publishLive", () => {
    it("calls the publish-live action with the right ids", async () => {
      mockedPublish.mockResolvedValue({
        data: {
          articleId: "a1",
          wpPostId: 7,
          wpPostUrl: "https://x.com/?p=7",
          wpStatus: "publish",
          publishedLocally: true,
        },
        error: null,
      });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.publishLive());
      await waitFor(() =>
        expect(mockedPublish).toHaveBeenCalledWith("t1", "p1", "b1", "a1"),
      );
    });

    it("captures the success result, refreshes, and tracks isPublishing", async () => {
      mockedPublish.mockResolvedValue({
        data: {
          articleId: "a1",
          wpPostId: 7,
          wpPostUrl: "https://x.com/?p=7",
          wpStatus: "publish",
          publishedLocally: true,
        },
        error: null,
      });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.publishLive());

      await waitFor(() =>
        expect(result.current.lastResult).toEqual(
          expect.objectContaining({ wpStatus: "publish" }),
        ),
      );
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(result.current.isPublishing).toBe(false);
    });

    it("invokes onSuccess with the publish action label", async () => {
      const onSuccess = vi.fn();
      mockedPublish.mockResolvedValue({
        data: {
          articleId: "a1",
          wpPostId: 7,
          wpPostUrl: null,
          wpStatus: "publish",
          publishedLocally: true,
        },
        error: null,
      });
      const { result } = renderHook(() =>
        useWordPressPublish({ ...baseProps, onSuccess }),
      );

      act(() => result.current.publishLive());
      await waitFor(() =>
        expect(onSuccess).toHaveBeenCalledWith(expect.any(Object), "publish"),
      );
    });
  });

  // --------------------------------------------------------------
  // clearLink
  // --------------------------------------------------------------

  describe("clearLink", () => {
    it("calls the clear action and refreshes", async () => {
      mockedClear.mockResolvedValue({
        data: { articleId: "a1" },
        error: null,
      });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.clearLink());
      await waitFor(() =>
        expect(mockedClear).toHaveBeenCalledWith("t1", "p1", "b1", "a1"),
      );
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    });

    it("flips isClearing while in flight", async () => {
      let resolve!: (v: {
        data: { articleId: string } | null;
        error: string | null;
      }) => void;
      mockedClear.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }) as never,
      );
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.clearLink());
      await waitFor(() => expect(result.current.isClearing).toBe(true));
      expect(result.current.pendingAction).toBe("clear");

      await act(async () => {
        resolve({ data: { articleId: "a1" }, error: null });
      });
      await waitFor(() => expect(result.current.isClearing).toBe(false));
    });

    it("wipes lastResult on success so the success block disappears", async () => {
      mockedSend.mockResolvedValue({
        data: { articleId: "a1", wpPostId: 7, wpPostUrl: null },
        error: null,
      });
      mockedClear.mockResolvedValue({
        data: { articleId: "a1" },
        error: null,
      });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.send());
      await waitFor(() => expect(result.current.lastResult?.wpPostId).toBe(7));

      act(() => result.current.clearLink());
      await waitFor(() => expect(result.current.lastResult).toBeNull());
    });

    it("surfaces clear errors and does not refresh", async () => {
      mockedClear.mockResolvedValue({ data: null, error: "db down" });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.clearLink());
      await waitFor(() => expect(result.current.error).toBe("db down"));
      expect(refreshMock).not.toHaveBeenCalled();
      expect(result.current.isClearing).toBe(false);
    });
  });

  // --------------------------------------------------------------
  // pendingAction is mutually exclusive
  // --------------------------------------------------------------

  describe("pendingAction", () => {
    it("clears errorIsRemoteMissing when error is reset", async () => {
      mockedUpdate.mockResolvedValue({
        data: null,
        error: PUBLISH_ARTICLE_ERROR_COPY.wp_post_not_found,
      });
      const { result } = renderHook(() => useWordPressPublish(baseProps));

      act(() => result.current.updateDraft());
      await waitFor(() =>
        expect(result.current.errorIsRemoteMissing).toBe(true),
      );

      act(() => result.current.resetError());
      expect(result.current.errorIsRemoteMissing).toBe(false);
    });
  });
});
