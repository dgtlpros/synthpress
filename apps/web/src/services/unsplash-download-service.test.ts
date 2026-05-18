import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triggerUnsplashDownload } from "./unsplash-download-service";

const ORIGINAL_KEY = process.env.UNSPLASH_ACCESS_KEY;

beforeEach(() => {
  process.env.UNSPLASH_ACCESS_KEY = "test-access-key";
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.UNSPLASH_ACCESS_KEY;
  } else {
    process.env.UNSPLASH_ACCESS_KEY = ORIGINAL_KEY;
  }
});

describe("triggerUnsplashDownload — short-circuits", () => {
  it("returns no_download_location for a missing URL", async () => {
    const fetchImpl = vi.fn();
    const result = await triggerUnsplashDownload({
      downloadLocation: null,
      fetchImpl: fetchImpl as never,
    });
    expect(result).toEqual({ success: false, reason: "no_download_location" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns no_download_location for undefined URL", async () => {
    const fetchImpl = vi.fn();
    const result = await triggerUnsplashDownload({
      downloadLocation: undefined,
      fetchImpl: fetchImpl as never,
    });
    expect(result).toEqual({ success: false, reason: "no_download_location" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns no_download_location for whitespace-only URL", async () => {
    const fetchImpl = vi.fn();
    const result = await triggerUnsplashDownload({
      downloadLocation: "   ",
      fetchImpl: fetchImpl as never,
    });
    expect(result).toEqual({ success: false, reason: "no_download_location" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns missing_access_key when env var is unset", async () => {
    delete process.env.UNSPLASH_ACCESS_KEY;
    const fetchImpl = vi.fn();
    const result = await triggerUnsplashDownload({
      downloadLocation: "https://api.unsplash.com/photos/abc/download",
      fetchImpl: fetchImpl as never,
    });
    expect(result).toEqual({ success: false, reason: "missing_access_key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns missing_access_key when env var is empty string", async () => {
    process.env.UNSPLASH_ACCESS_KEY = "";
    const fetchImpl = vi.fn();
    const result = await triggerUnsplashDownload({
      downloadLocation: "https://api.unsplash.com/photos/abc/download",
      fetchImpl: fetchImpl as never,
    });
    expect(result).toEqual({ success: false, reason: "missing_access_key" });
  });
});

describe("triggerUnsplashDownload — request shape", () => {
  it("sends GET with Client-ID auth + Accept JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await triggerUnsplashDownload({
      downloadLocation: "https://api.unsplash.com/photos/abc/download?ix=foo",
      fetchImpl: fetchImpl as never,
    });

    expect(result).toEqual({ success: true, reason: "sent" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.unsplash.com/photos/abc/download?ix=foo",
      {
        method: "GET",
        headers: {
          Authorization: "Client-ID test-access-key",
          Accept: "application/json",
        },
      },
    );
  });

  it("respects an injected accessKey override", async () => {
    delete process.env.UNSPLASH_ACCESS_KEY;
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await triggerUnsplashDownload({
      downloadLocation: "https://api.unsplash.com/photos/abc/download",
      accessKey: "override-key",
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl.mock.calls[0]![1]!.headers).toMatchObject({
      Authorization: "Client-ID override-key",
    });
  });
});

describe("triggerUnsplashDownload — failure modes (never throws)", () => {
  it("returns request_failed on a thrown fetch (no exception bubbles)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const result = await triggerUnsplashDownload({
      downloadLocation: "https://api.unsplash.com/photos/abc/download",
      fetchImpl: fetchImpl as never,
    });
    expect(result).toEqual({ success: false, reason: "request_failed" });
  });

  it("returns request_failed on a non-Error rejection", async () => {
    const fetchImpl = vi.fn().mockRejectedValue("oops");
    const result = await triggerUnsplashDownload({
      downloadLocation: "https://api.unsplash.com/photos/abc/download",
      fetchImpl: fetchImpl as never,
    });
    expect(result).toEqual({ success: false, reason: "request_failed" });
  });

  it("returns non_2xx on a 4xx/5xx response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 429, statusText: "Too Many" });
    const result = await triggerUnsplashDownload({
      downloadLocation: "https://api.unsplash.com/photos/abc/download",
      fetchImpl: fetchImpl as never,
    });
    expect(result).toEqual({ success: false, reason: "non_2xx" });
  });

  it("falls back to globalThis.fetch when no fetchImpl is provided", async () => {
    const realFetch = globalThis.fetch;
    const stubbed = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = stubbed as never;
    try {
      const result = await triggerUnsplashDownload({
        downloadLocation: "https://api.unsplash.com/photos/abc/download",
      });
      expect(result).toEqual({ success: true, reason: "sent" });
      expect(stubbed).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
