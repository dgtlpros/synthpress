import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/actions/unsplash", () => ({
  searchUnsplash: vi.fn(),
}));

import { searchUnsplash } from "@/actions/unsplash";
import { useUnsplashSearch } from "./useUnsplashSearch";

const mockedSearch = vi.mocked(searchUnsplash);

const SAMPLE_PHOTO = {
  provider: "unsplash" as const,
  providerPhotoId: "abc",
  description: null,
  altDescription: "Desk with laptop",
  thumbUrl: "https://images.unsplash.com/photo-abc?w=200",
  regularUrl: "https://images.unsplash.com/photo-abc?w=1080",
  fullUrl: null,
  photographerName: "Annie",
  photographerProfileUrl: "https://unsplash.com/@anniespratt",
  photoUrl: "https://unsplash.com/photos/abc",
  downloadLocation: "https://api.unsplash.com/photos/abc/download",
};

beforeEach(() => {
  mockedSearch.mockReset();
});

describe("useUnsplashSearch", () => {
  it("starts idle with the supplied initial query", () => {
    const { result } = renderHook(() =>
      useUnsplashSearch({ teamId: "t1", initialQuery: "smart home" }),
    );
    expect(result.current.query).toBe("smart home");
    expect(result.current.isSearching).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.results).toEqual([]);
    expect(result.current.totalResults).toBeNull();
    expect(result.current.hasSearched).toBe(false);
  });

  it("defaults the initial query to an empty string", () => {
    const { result } = renderHook(() => useUnsplashSearch({ teamId: "t1" }));
    expect(result.current.query).toBe("");
  });

  it("setQuery updates the query state", () => {
    const { result } = renderHook(() => useUnsplashSearch({ teamId: "t1" }));
    act(() => result.current.setQuery("cats"));
    expect(result.current.query).toBe("cats");
  });

  it("search() forwards the trimmed current query to the action", async () => {
    mockedSearch.mockResolvedValue({
      data: { results: [SAMPLE_PHOTO], totalResults: 1, totalPages: 1 },
      error: null,
    });
    const { result } = renderHook(() =>
      useUnsplashSearch({ teamId: "t1", initialQuery: "  cats  " }),
    );

    act(() => result.current.search());
    await waitFor(() =>
      expect(mockedSearch).toHaveBeenCalledWith("t1", { query: "cats" }),
    );
  });

  it("search(override) forwards the override AND updates the input state", async () => {
    mockedSearch.mockResolvedValue({
      data: { results: [], totalResults: 0, totalPages: 0 },
      error: null,
    });
    const { result } = renderHook(() => useUnsplashSearch({ teamId: "t1" }));

    act(() => result.current.search("smart home cameras"));
    await waitFor(() =>
      expect(mockedSearch).toHaveBeenCalledWith("t1", {
        query: "smart home cameras",
      }),
    );
    expect(result.current.query).toBe("smart home cameras");
  });

  it("captures successful results and totalResults", async () => {
    mockedSearch.mockResolvedValue({
      data: { results: [SAMPLE_PHOTO], totalResults: 42, totalPages: 4 },
      error: null,
    });
    const { result } = renderHook(() => useUnsplashSearch({ teamId: "t1" }));

    act(() => result.current.search("cats"));
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.totalResults).toBe(42);
    expect(result.current.error).toBeNull();
  });

  it("flips hasSearched=true the moment a search is fired (even before completion)", async () => {
    mockedSearch.mockResolvedValue({
      data: { results: [], totalResults: 0, totalPages: 0 },
      error: null,
    });
    const { result } = renderHook(() => useUnsplashSearch({ teamId: "t1" }));

    expect(result.current.hasSearched).toBe(false);
    act(() => result.current.search("cats"));
    expect(result.current.hasSearched).toBe(true);
  });

  it("totalResults=0 after a successful search that returned no hits", async () => {
    mockedSearch.mockResolvedValue({
      data: { results: [], totalResults: 0, totalPages: 0 },
      error: null,
    });
    const { result } = renderHook(() => useUnsplashSearch({ teamId: "t1" }));

    act(() => result.current.search("zzzzzzzzzz"));
    await waitFor(() => expect(result.current.totalResults).toBe(0));
    expect(result.current.results).toEqual([]);
  });

  it("coerces a missing totalResults (future provider with no count) to 0", async () => {
    mockedSearch.mockResolvedValue({
      // Some providers don't expose total counts; the generic
      // adapter type marks `totalResults` as optional. The hook
      // must not surface `undefined` to the picker.
      data: { results: [SAMPLE_PHOTO] } as unknown as never,
      error: null,
    });
    const { result } = renderHook(() => useUnsplashSearch({ teamId: "t1" }));

    act(() => result.current.search("x"));
    await waitFor(() => expect(result.current.totalResults).toBe(0));
  });

  it("surfaces action errors and leaves the previous results visible", async () => {
    mockedSearch
      .mockResolvedValueOnce({
        data: { results: [SAMPLE_PHOTO], totalResults: 1, totalPages: 1 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: "Unsplash rate limit reached.",
      });
    const { result } = renderHook(() => useUnsplashSearch({ teamId: "t1" }));

    act(() => result.current.search("first"));
    await waitFor(() => expect(result.current.results).toHaveLength(1));

    act(() => result.current.search("second"));
    await waitFor(() =>
      expect(result.current.error).toBe("Unsplash rate limit reached."),
    );
    // Old results stay so the user keeps context.
    expect(result.current.results).toHaveLength(1);
  });

  it("clears the error before each new search attempt", async () => {
    mockedSearch
      .mockResolvedValueOnce({ data: null, error: "boom" })
      .mockResolvedValueOnce({
        data: { results: [SAMPLE_PHOTO], totalResults: 1, totalPages: 1 },
        error: null,
      });
    const { result } = renderHook(() => useUnsplashSearch({ teamId: "t1" }));

    act(() => result.current.search("first"));
    await waitFor(() => expect(result.current.error).toBe("boom"));

    act(() => result.current.search("second"));
    await waitFor(() => expect(result.current.error).toBeNull());
    await waitFor(() => expect(result.current.results).toHaveLength(1));
  });

  it("resetError clears the error message", async () => {
    mockedSearch.mockResolvedValue({ data: null, error: "boom" });
    const { result } = renderHook(() => useUnsplashSearch({ teamId: "t1" }));

    act(() => result.current.search("x"));
    await waitFor(() => expect(result.current.error).toBe("boom"));

    act(() => result.current.resetError());
    expect(result.current.error).toBeNull();
  });
});
