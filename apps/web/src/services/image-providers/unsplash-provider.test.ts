import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unsplashProvider } from "./unsplash-provider";
import { UnsplashSearchError } from "../unsplash-service";
import { ImageSearchError } from "./types";

vi.mock("../unsplash-service", async () => {
  const actual = await vi.importActual<typeof import("../unsplash-service")>(
    "../unsplash-service",
  );
  return {
    ...actual,
    searchUnsplashPhotos: vi.fn(),
  };
});

vi.mock("../unsplash-download-service", () => ({
  triggerUnsplashDownload: vi.fn(),
}));

const { searchUnsplashPhotos } = await import("../unsplash-service");
const { triggerUnsplashDownload } =
  await import("../unsplash-download-service");
const mockedSearch = vi.mocked(searchUnsplashPhotos);
const mockedTrack = vi.mocked(triggerUnsplashDownload);

const SAMPLE_RAW = {
  id: "abc",
  description: "A modern home office",
  altDescription: "Desk with laptop and plant",
  thumbUrl: "https://images.unsplash.com/photo-abc?w=200",
  regularUrl: "https://images.unsplash.com/photo-abc?w=1080",
  fullUrl: "https://images.unsplash.com/photo-abc",
  photographerName: "Annie Spratt",
  photographerProfileUrl: "https://unsplash.com/@anniespratt",
  photoUrl: "https://unsplash.com/photos/abc",
  downloadLocation: "https://api.unsplash.com/photos/abc/download",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("unsplashProvider — identity", () => {
  it("declares the unsplash providerId + a human-readable display name", () => {
    expect(unsplashProvider.providerId).toBe("unsplash");
    expect(unsplashProvider.displayName).toBe("Unsplash");
  });
});

describe("unsplashProvider.searchImages", () => {
  it("forwards query / page / perPage / fetchImpl to the underlying service", async () => {
    mockedSearch.mockResolvedValue({
      results: [SAMPLE_RAW],
      totalResults: 1,
      totalPages: 1,
    });
    const fakeFetch = vi.fn();
    await unsplashProvider.searchImages({
      query: "smart locks",
      page: 3,
      perPage: 8,
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    expect(mockedSearch).toHaveBeenCalledWith({
      query: "smart locks",
      page: 3,
      perPage: 8,
      fetchImpl: fakeFetch,
    });
  });

  it("normalizes the Unsplash row into a NormalizedImageSearchResult", async () => {
    mockedSearch.mockResolvedValue({
      results: [SAMPLE_RAW],
      totalResults: 42,
      totalPages: 4,
    });
    const result = await unsplashProvider.searchImages({ query: "x" });
    expect(result).toEqual({
      results: [
        {
          provider: "unsplash",
          providerPhotoId: "abc",
          description: "A modern home office",
          altDescription: "Desk with laptop and plant",
          thumbUrl: "https://images.unsplash.com/photo-abc?w=200",
          regularUrl: "https://images.unsplash.com/photo-abc?w=1080",
          fullUrl: "https://images.unsplash.com/photo-abc",
          photographerName: "Annie Spratt",
          photographerProfileUrl: "https://unsplash.com/@anniespratt",
          photoUrl: "https://unsplash.com/photos/abc",
          downloadLocation: "https://api.unsplash.com/photos/abc/download",
        },
      ],
      totalResults: 42,
      totalPages: 4,
    });
  });

  it("normalizes optional Unsplash fields to null when missing", async () => {
    mockedSearch.mockResolvedValue({
      results: [
        { ...SAMPLE_RAW, fullUrl: undefined, downloadLocation: undefined },
      ],
      totalResults: 1,
      totalPages: 1,
    });
    const result = await unsplashProvider.searchImages({ query: "x" });
    expect(result.results[0]).toMatchObject({
      fullUrl: null,
      downloadLocation: null,
    });
  });

  it("re-wraps UnsplashSearchError as ImageSearchError with the same code (rate_limited passthrough)", async () => {
    mockedSearch.mockRejectedValue(new UnsplashSearchError("rate_limited"));
    await expect(
      unsplashProvider.searchImages({ query: "x" }),
    ).rejects.toMatchObject({
      name: "ImageSearchError",
      code: "rate_limited",
      providerId: "unsplash",
    });
  });

  it("re-wraps query_required + missing_access_key codes verbatim", async () => {
    mockedSearch.mockRejectedValueOnce(
      new UnsplashSearchError("query_required"),
    );
    await expect(
      unsplashProvider.searchImages({ query: "" }),
    ).rejects.toMatchObject({ code: "query_required" });

    mockedSearch.mockRejectedValueOnce(
      new UnsplashSearchError("missing_access_key"),
    );
    await expect(
      unsplashProvider.searchImages({ query: "x" }),
    ).rejects.toMatchObject({ code: "missing_access_key" });
  });

  it("collapses unsplash_request_failed onto the generic request_failed code (preserving details)", async () => {
    mockedSearch.mockRejectedValue(
      new UnsplashSearchError(
        "unsplash_request_failed",
        "503 Service Unavailable",
      ),
    );
    let caught: ImageSearchError | undefined;
    try {
      await unsplashProvider.searchImages({ query: "x" });
    } catch (err) {
      caught = err as ImageSearchError;
    }
    expect(caught).toBeInstanceOf(ImageSearchError);
    expect(caught?.code).toBe("request_failed");
    expect(caught?.details).toBe("503 Service Unavailable");
    expect(caught?.providerId).toBe("unsplash");
  });

  it("collapses unsplash_invalid_response onto the generic invalid_response code", async () => {
    mockedSearch.mockRejectedValue(
      new UnsplashSearchError("unsplash_invalid_response", "missing results"),
    );
    await expect(
      unsplashProvider.searchImages({ query: "x" }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      details: "missing results",
    });
  });

  it("re-throws non-UnsplashSearchError errors unchanged", async () => {
    const boom = new Error("network exploded");
    mockedSearch.mockRejectedValue(boom);
    await expect(unsplashProvider.searchImages({ query: "x" })).rejects.toBe(
      boom,
    );
  });
});

describe("unsplashProvider.trackDownload", () => {
  it("forwards downloadLocation + fetchImpl to triggerUnsplashDownload", async () => {
    mockedTrack.mockResolvedValue({ success: true, reason: "sent" });
    const fakeFetch = vi.fn();
    await unsplashProvider.trackDownload({
      downloadLocation: "https://api.unsplash.com/photos/abc/download",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    expect(mockedTrack).toHaveBeenCalledWith({
      downloadLocation: "https://api.unsplash.com/photos/abc/download",
      fetchImpl: fakeFetch,
    });
  });

  it("renames success → tracked while preserving the underlying reason", async () => {
    mockedTrack.mockResolvedValue({ success: true, reason: "sent" });
    expect(
      await unsplashProvider.trackDownload({
        downloadLocation: "x",
      }),
    ).toEqual({ tracked: true, reason: "sent" });

    mockedTrack.mockResolvedValue({
      success: false,
      reason: "no_download_location",
    });
    expect(
      await unsplashProvider.trackDownload({ downloadLocation: null }),
    ).toEqual({ tracked: false, reason: "no_download_location" });

    mockedTrack.mockResolvedValue({ success: false, reason: "non_2xx" });
    expect(
      await unsplashProvider.trackDownload({ downloadLocation: "x" }),
    ).toEqual({ tracked: false, reason: "non_2xx" });
  });
});

afterEach(() => {
  vi.resetAllMocks();
});
