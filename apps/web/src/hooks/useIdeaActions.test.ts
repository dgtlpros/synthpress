import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/article-generation", () => ({
  updateIdeaStatus: vi.fn(),
  archiveIdea: vi.fn(),
  unarchiveIdea: vi.fn(),
}));

import {
  archiveIdea,
  unarchiveIdea,
  updateIdeaStatus,
} from "@/actions/article-generation";
import { useIdeaActions } from "./useIdeaActions";

const mockedUpdate = vi.mocked(updateIdeaStatus);
const mockedArchive = vi.mocked(archiveIdea);
const mockedUnarchive = vi.mocked(unarchiveIdea);

beforeEach(() => {
  refreshMock.mockClear();
  mockedUpdate.mockReset();
  mockedArchive.mockReset();
  mockedUnarchive.mockReset();
});

const baseProps = { teamId: "t1", projectId: "p1", blogId: "b1" };

describe("useIdeaActions", () => {
  it("calls the action with status=approved when approve is invoked", async () => {
    mockedUpdate.mockResolvedValue({
      data: { ideaId: "i1", status: "approved" },
      error: null,
    });
    const { result } = renderHook(() => useIdeaActions(baseProps));

    act(() => result.current.approve("i1"));

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith(
        "t1",
        "p1",
        "b1",
        "i1",
        "approved",
      );
    });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("calls the action with status=rejected when reject is invoked", async () => {
    mockedUpdate.mockResolvedValue({
      data: { ideaId: "i1", status: "rejected" },
      error: null,
    });
    const { result } = renderHook(() => useIdeaActions(baseProps));

    act(() => result.current.reject("i1"));

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith(
        "t1",
        "p1",
        "b1",
        "i1",
        "rejected",
      );
    });
  });

  it("calls archiveIdea with the idea id when archive is invoked", async () => {
    mockedArchive.mockResolvedValue({
      data: { ideaId: "i1", archivedAt: new Date().toISOString() },
      error: null,
    });
    const { result } = renderHook(() => useIdeaActions(baseProps));

    act(() => result.current.archive("i1"));

    await waitFor(() => {
      expect(mockedArchive).toHaveBeenCalledWith("t1", "p1", "b1", "i1");
    });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("calls unarchiveIdea with the idea id when unarchive is invoked", async () => {
    mockedUnarchive.mockResolvedValue({
      data: { ideaId: "i1" },
      error: null,
    });
    const { result } = renderHook(() => useIdeaActions(baseProps));

    act(() => result.current.unarchive("i1"));

    await waitFor(() => {
      expect(mockedUnarchive).toHaveBeenCalledWith("t1", "p1", "b1", "i1");
    });
  });

  it("exposes the archiving action through pendingAction during the call", async () => {
    let resolveArchive: (value: {
      data: { ideaId: string; archivedAt: string };
      error: null;
    }) => void = () => {};
    mockedArchive.mockReturnValue(
      new Promise((res) => {
        resolveArchive = res;
      }),
    );

    const { result } = renderHook(() => useIdeaActions(baseProps));
    act(() => result.current.archive("i1"));

    await waitFor(() => {
      expect(result.current.pendingIdeaId).toBe("i1");
    });
    expect(result.current.pendingAction).toBe("archiving");
    // pendingStatus stays null because archive isn't a status transition.
    expect(result.current.pendingStatus).toBeNull();

    act(() =>
      resolveArchive({
        data: { ideaId: "i1", archivedAt: new Date().toISOString() },
        error: null,
      }),
    );
    await waitFor(() => {
      expect(result.current.pendingIdeaId).toBeNull();
    });
  });

  it("exposes the approved status through pendingStatus during approve", async () => {
    let resolveUpdate: (value: {
      data: { ideaId: string; status: "approved" };
      error: null;
    }) => void = () => {};
    mockedUpdate.mockReturnValue(
      new Promise((res) => {
        resolveUpdate = res;
      }),
    );

    const { result } = renderHook(() => useIdeaActions(baseProps));
    act(() => result.current.approve("i1"));

    await waitFor(() => {
      expect(result.current.pendingIdeaId).toBe("i1");
    });
    expect(result.current.pendingStatus).toBe("approved");
    expect(result.current.pendingAction).toBe("approved");

    act(() =>
      resolveUpdate({
        data: { ideaId: "i1", status: "approved" },
        error: null,
      }),
    );
    await waitFor(() => {
      expect(result.current.pendingIdeaId).toBeNull();
    });
  });

  it("clears pending state and skips refresh on error", async () => {
    mockedUpdate.mockResolvedValue({
      data: null,
      error: "This idea can't be changed to that status.",
    });
    const { result } = renderHook(() => useIdeaActions(baseProps));

    act(() => result.current.approve("i1"));

    await waitFor(() => {
      expect(result.current.errorIdeaId).toBe("i1");
    });
    expect(result.current.errorMessage).toMatch(/can't be changed/i);
    expect(result.current.pendingIdeaId).toBeNull();
    expect(result.current.pendingAction).toBeNull();
    expect(result.current.pendingStatus).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("clears pending state on archive error", async () => {
    mockedArchive.mockResolvedValue({
      data: null,
      error: "Idea not found.",
    });
    const { result } = renderHook(() => useIdeaActions(baseProps));

    act(() => result.current.archive("i1"));

    await waitFor(() => {
      expect(result.current.errorIdeaId).toBe("i1");
    });
    expect(result.current.errorMessage).toMatch(/not found/i);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("clears the previous error when a new action starts", async () => {
    mockedUpdate.mockResolvedValueOnce({ data: null, error: "boom" });
    const { result } = renderHook(() => useIdeaActions(baseProps));

    act(() => result.current.approve("i1"));
    await waitFor(() => {
      expect(result.current.errorMessage).toBe("boom");
    });

    mockedUpdate.mockResolvedValueOnce({
      data: { ideaId: "i2", status: "approved" },
      error: null,
    });
    act(() => result.current.approve("i2"));

    await waitFor(() => {
      expect(result.current.errorMessage).toBeNull();
    });
    expect(result.current.errorIdeaId).toBeNull();
  });

  it("exposes resetError for the connector to call when closing UI", async () => {
    mockedUpdate.mockResolvedValueOnce({ data: null, error: "boom" });
    const { result } = renderHook(() => useIdeaActions(baseProps));

    act(() => result.current.approve("i1"));
    await waitFor(() => {
      expect(result.current.errorMessage).toBe("boom");
    });

    act(() => result.current.resetError());
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.errorIdeaId).toBeNull();
  });
});
