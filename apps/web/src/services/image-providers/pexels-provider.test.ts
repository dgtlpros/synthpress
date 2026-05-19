import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pexelsProvider } from "./pexels-provider";
import { ImageSearchError } from "./types";

/**
 * Builds a fake `Response`-shaped object the helper can consume.
 * Mirrors the pattern from `unsplash-service.test.ts` — avoids
 * `new Response()` because the global constructor isn't always
 * polyfilled the same way across environments.
 */
function makeResponse(
  opts: {
    status?: number;
    statusText?: string;
    ok?: boolean;
    json?: unknown;
    text?: string;
    jsonThrows?: Error | string;
  } = {},
): Response {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  return {
    status,
    statusText: opts.statusText ?? "OK",
    ok,
    headers: new Headers(),
    json: vi.fn().mockImplementation(async () => {
      if (opts.jsonThrows !== undefined) throw opts.jsonThrows;
      return opts.json;
    }),
    text: vi.fn().mockResolvedValue(opts.text ?? ""),
  } as unknown as Response;
}

const SAMPLE_PEXELS_PHOTO = {
  id: 12345,
  url: "https://www.pexels.com/photo/12345/",
  alt: "Desk with laptop and plant",
  photographer: "Sam Person",
  photographer_url: "https://www.pexels.com/@sam",
  photographer_id: 999,
  src: {
    original: "https://images.pexels.com/photos/12345/original.jpg",
    large2x: "https://images.pexels.com/photos/12345/large2x.jpg",
    large: "https://images.pexels.com/photos/12345/large.jpg",
    medium: "https://images.pexels.com/photos/12345/medium.jpg",
    small: "https://images.pexels.com/photos/12345/small.jpg",
    portrait: "https://images.pexels.com/photos/12345/portrait.jpg",
    landscape: "https://images.pexels.com/photos/12345/landscape.jpg",
    tiny: "https://images.pexels.com/photos/12345/tiny.jpg",
  },
};

const ORIGINAL_KEY = process.env.PEXELS_API_KEY;

beforeEach(() => {
  process.env.PEXELS_API_KEY = "test-pexels-key";
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.PEXELS_API_KEY;
  } else {
    process.env.PEXELS_API_KEY = ORIGINAL_KEY;
  }
});

describe("pexelsProvider — identity", () => {
  it("declares the pexels providerId + a human-readable display name", () => {
    expect(pexelsProvider.providerId).toBe("pexels");
    expect(pexelsProvider.displayName).toBe("Pexels");
  });
});

describe("pexelsProvider.searchImages — happy path", () => {
  it("calls the Pexels search endpoint with query/page/per_page/orientation params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: { photos: [SAMPLE_PEXELS_PHOTO], total_results: 1 },
      }),
    );
    await pexelsProvider.searchImages({
      query: "modern home office",
      page: 2,
      perPage: 15,
      fetchImpl: fetchImpl as never,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://api.pexels.com/v1/search");
    expect(url.searchParams.get("query")).toBe("modern home office");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("per_page")).toBe("15");
    expect(url.searchParams.get("orientation")).toBe("landscape");
  });

  it("sends the bare PEXELS_API_KEY in the Authorization header (NOT 'Bearer …')", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { photos: [], total_results: 0 } }),
      );
    await pexelsProvider.searchImages({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    // Pexels expects the bare key — `Bearer …` would be rejected.
    expect(headers.Authorization).toBe("test-pexels-key");
    expect(headers.Accept).toBe("application/json");
  });

  it("normalizes the photo into a NormalizedImageSearchResult", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: { photos: [SAMPLE_PEXELS_PHOTO], total_results: 42 },
      }),
    );
    const result = await pexelsProvider.searchImages({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result).toEqual({
      results: [
        {
          provider: "pexels",
          providerPhotoId: "12345",
          description: "Desk with laptop and plant",
          altDescription: "Desk with laptop and plant",
          // medium → thumb (best small-grid size)
          thumbUrl: "https://images.pexels.com/photos/12345/medium.jpg",
          // large → regular (closest to Unsplash's `regular`)
          regularUrl: "https://images.pexels.com/photos/12345/large.jpg",
          fullUrl: "https://images.pexels.com/photos/12345/original.jpg",
          photographerName: "Sam Person",
          photographerProfileUrl: "https://www.pexels.com/@sam",
          photoUrl: "https://www.pexels.com/photo/12345/",
          downloadLocation: null,
        },
      ],
      totalResults: 42,
    });
  });

  it("falls back through src.medium → src.small → src.tiny for thumbUrl", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: {
          photos: [
            {
              ...SAMPLE_PEXELS_PHOTO,
              src: {
                ...SAMPLE_PEXELS_PHOTO.src,
                medium: null,
                // small still set → expect small as thumb.
              },
            },
          ],
          total_results: 1,
        },
      }),
    );
    const result = await pexelsProvider.searchImages({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results[0]!.thumbUrl).toBe(
      "https://images.pexels.com/photos/12345/small.jpg",
    );
  });

  it("falls back to src.tiny for thumbUrl when both medium and small are missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: {
          photos: [
            {
              ...SAMPLE_PEXELS_PHOTO,
              src: {
                ...SAMPLE_PEXELS_PHOTO.src,
                medium: null,
                small: null,
                // tiny still present → final fallback wins.
              },
            },
          ],
          total_results: 1,
        },
      }),
    );
    const result = await pexelsProvider.searchImages({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results[0]!.thumbUrl).toBe(
      "https://images.pexels.com/photos/12345/tiny.jpg",
    );
  });

  it("filters out a row whose every thumb size is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: {
          photos: [
            {
              ...SAMPLE_PEXELS_PHOTO,
              src: {
                ...SAMPLE_PEXELS_PHOTO.src,
                medium: null,
                small: null,
                tiny: null,
              },
            },
          ],
          total_results: 1,
        },
      }),
    );
    const result = await pexelsProvider.searchImages({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results).toEqual([]);
  });

  it("falls back through src.large2x → src.original for regularUrl when large is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: {
          photos: [
            {
              ...SAMPLE_PEXELS_PHOTO,
              src: {
                ...SAMPLE_PEXELS_PHOTO.src,
                large: null,
                large2x: null,
                // original still present → final fallback wins.
              },
            },
          ],
          total_results: 1,
        },
      }),
    );
    const result = await pexelsProvider.searchImages({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results[0]!.regularUrl).toBe(
      "https://images.pexels.com/photos/12345/original.jpg",
    );
  });

  it("filters out a row whose every regular-size url is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: {
          photos: [
            {
              ...SAMPLE_PEXELS_PHOTO,
              src: {
                ...SAMPLE_PEXELS_PHOTO.src,
                large: null,
                large2x: null,
                original: null,
              },
            },
          ],
          total_results: 1,
        },
      }),
    );
    const result = await pexelsProvider.searchImages({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results).toEqual([]);
  });

  it("normalizes fullUrl to null when src.original is missing or non-string", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: {
          photos: [
            {
              ...SAMPLE_PEXELS_PHOTO,
              src: {
                ...SAMPLE_PEXELS_PHOTO.src,
                // original null → fullUrl falls to null even when
                // large/large2x are present, so the regular-URL
                // fallback chain is what carries the row through.
                original: null,
              },
            },
          ],
          total_results: 1,
        },
      }),
    );
    const result = await pexelsProvider.searchImages({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.fullUrl).toBeNull();
  });

  it("treats a non-string `alt` field as null on the normalized row", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: {
          photos: [
            {
              ...SAMPLE_PEXELS_PHOTO,
              alt: null, // non-string → trimmed to "" → null
            },
          ],
          total_results: 1,
        },
      }),
    );
    const result = await pexelsProvider.searchImages({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results[0]!.altDescription).toBeNull();
    expect(result.results[0]!.description).toBeNull();
  });

  it("falls back through src.large → src.large2x → src.original for regularUrl", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: {
          photos: [
            {
              ...SAMPLE_PEXELS_PHOTO,
              src: { ...SAMPLE_PEXELS_PHOTO.src, large: null },
            },
          ],
          total_results: 1,
        },
      }),
    );
    const result = await pexelsProvider.searchImages({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results[0]!.regularUrl).toBe(
      "https://images.pexels.com/photos/12345/large2x.jpg",
    );
  });

  it("normalizes missing photographer / url / alt fields to null", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: {
          photos: [
            {
              id: 99,
              alt: "",
              photographer: null,
              photographer_url: null,
              url: null,
              src: SAMPLE_PEXELS_PHOTO.src,
            },
          ],
          total_results: 1,
        },
      }),
    );
    const result = await pexelsProvider.searchImages({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results[0]).toMatchObject({
      providerPhotoId: "99",
      description: null,
      altDescription: null,
      photographerName: null,
      photographerProfileUrl: null,
      photoUrl: null,
      downloadLocation: null,
    });
  });

  it("filters out malformed rows (missing id / src) without sinking the response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: {
          photos: [
            // Bad: no id.
            { src: SAMPLE_PEXELS_PHOTO.src },
            // Bad: missing src altogether.
            { id: 7 },
            // Good.
            SAMPLE_PEXELS_PHOTO,
            // Bad: not an object.
            "string-row",
          ],
          total_results: 4,
        },
      }),
    );
    const result = await pexelsProvider.searchImages({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.providerPhotoId).toBe("12345");
  });

  it("returns an empty results array when Pexels returns no photos", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { photos: [], total_results: 0 } }),
      );
    const result = await pexelsProvider.searchImages({
      query: "no-such-query-zzz",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results).toEqual([]);
    expect(result.totalResults).toBe(0);
  });

  it("clamps perPage to >=1 and caps at the provider max (80)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ json: { photos: [] } }));
    await pexelsProvider.searchImages({
      query: "x",
      perPage: 9999,
      fetchImpl: fetchImpl as never,
    });
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.searchParams.get("per_page")).toBe("80");
    fetchImpl.mockClear();
    await pexelsProvider.searchImages({
      query: "x",
      perPage: 0,
      fetchImpl: fetchImpl as never,
    });
    const url2 = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url2.searchParams.get("per_page")).toBe("1");
  });

  it("clamps page to >=1", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ json: { photos: [] } }));
    await pexelsProvider.searchImages({
      query: "x",
      page: 0,
      fetchImpl: fetchImpl as never,
    });
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.searchParams.get("page")).toBe("1");
  });
});

describe("pexelsProvider.searchImages — error mapping", () => {
  it("throws query_required for empty / whitespace-only queries", async () => {
    await expect(
      pexelsProvider.searchImages({ query: "", fetchImpl: vi.fn() as never }),
    ).rejects.toMatchObject({
      name: "ImageSearchError",
      code: "query_required",
      providerId: "pexels",
    });
    await expect(
      pexelsProvider.searchImages({
        query: "   ",
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({
      name: "ImageSearchError",
      code: "query_required",
    });
  });

  it("throws missing_access_key when PEXELS_API_KEY is unset", async () => {
    delete process.env.PEXELS_API_KEY;
    await expect(
      pexelsProvider.searchImages({ query: "x", fetchImpl: vi.fn() as never }),
    ).rejects.toMatchObject({
      name: "ImageSearchError",
      code: "missing_access_key",
      providerId: "pexels",
    });
  });

  it("throws missing_access_key when PEXELS_API_KEY is the empty string", async () => {
    process.env.PEXELS_API_KEY = "";
    await expect(
      pexelsProvider.searchImages({ query: "x", fetchImpl: vi.fn() as never }),
    ).rejects.toMatchObject({ code: "missing_access_key" });
  });

  it("throws rate_limited on a 429 response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ status: 429, statusText: "Too Many Requests" }),
      );
    await expect(
      pexelsProvider.searchImages({
        query: "x",
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      name: "ImageSearchError",
      code: "rate_limited",
      providerId: "pexels",
    });
  });

  it("throws request_failed on a 401 (invalid / revoked key)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        status: 401,
        statusText: "Unauthorized",
        text: "auth_failed",
      }),
    );
    let caught: ImageSearchError | undefined;
    try {
      await pexelsProvider.searchImages({
        query: "x",
        fetchImpl: fetchImpl as never,
      });
    } catch (err) {
      caught = err as ImageSearchError;
    }
    expect(caught).toBeInstanceOf(ImageSearchError);
    expect(caught?.code).toBe("request_failed");
    expect(caught?.details).toContain("401");
    expect(caught?.providerId).toBe("pexels");
  });

  it("throws request_failed on a 403 (forbidden)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        status: 403,
        statusText: "Forbidden",
        text: "",
      }),
    );
    await expect(
      pexelsProvider.searchImages({
        query: "x",
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "request_failed",
      providerId: "pexels",
    });
  });

  it("throws request_failed on other non-2xx responses (e.g. 500)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        status: 503,
        statusText: "Service Unavailable",
        text: "upstream",
      }),
    );
    let caught: ImageSearchError | undefined;
    try {
      await pexelsProvider.searchImages({
        query: "x",
        fetchImpl: fetchImpl as never,
      });
    } catch (err) {
      caught = err as ImageSearchError;
    }
    expect(caught?.code).toBe("request_failed");
    expect(caught?.details).toContain("503");
    expect(caught?.details).toContain("upstream");
  });

  it("throws request_failed when fetch itself rejects (network error)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    let caught: ImageSearchError | undefined;
    try {
      await pexelsProvider.searchImages({
        query: "x",
        fetchImpl: fetchImpl as never,
      });
    } catch (err) {
      caught = err as ImageSearchError;
    }
    expect(caught?.code).toBe("request_failed");
    expect(caught?.details).toBe("ECONNRESET");
  });

  it("falls back to 'network_error' details when fetch rejects with a non-Error value", async () => {
    // A fetch impl that throws a string / number instead of an
    // Error (rare but possible in custom polyfills) should still
    // surface a typed ImageSearchError with a sensible details.
    const fetchImpl = vi.fn().mockRejectedValue("string-rejection");
    await expect(
      pexelsProvider.searchImages({
        query: "x",
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "request_failed",
      details: "network_error",
    });
  });

  it("throws invalid_response when response.json() throws", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ jsonThrows: new Error("syntax error") }),
      );
    await expect(
      pexelsProvider.searchImages({
        query: "x",
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      details: "syntax error",
    });
  });

  it("falls back to 'invalid_json' details when response.json() throws a non-Error value", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ jsonThrows: "string-throw" }));
    await expect(
      pexelsProvider.searchImages({
        query: "x",
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      details: "invalid_json",
    });
  });

  it("throws invalid_response when the body isn't an object", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ json: "not-an-object" }));
    await expect(
      pexelsProvider.searchImages({
        query: "x",
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      details: "expected object",
    });
  });

  it("throws invalid_response when `photos` is missing or not an array", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ json: { total_results: 0 } }));
    await expect(
      pexelsProvider.searchImages({
        query: "x",
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      details: "missing photos array",
    });
  });
});

describe("pexelsProvider.searchImages — globalThis.fetch fallback", () => {
  it("uses globalThis.fetch when no fetchImpl is passed in the input", async () => {
    // Stub the global fetch for this test so the production code
    // path (which defaults to `globalThis.fetch`) is exercised
    // without making a real network call.
    const stubFetch = vi
      .fn()
      .mockResolvedValue(makeResponse({ json: { photos: [] } }));
    vi.stubGlobal("fetch", stubFetch);
    try {
      const result = await pexelsProvider.searchImages({ query: "x" });
      expect(result.results).toEqual([]);
      expect(stubFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("pexelsProvider.trackDownload — no-op", () => {
  it("returns tracked=false reason='not_supported' regardless of downloadLocation value", async () => {
    expect(
      await pexelsProvider.trackDownload({
        downloadLocation: "https://example.com/track",
      }),
    ).toEqual({ tracked: false, reason: "not_supported" });

    expect(
      await pexelsProvider.trackDownload({ downloadLocation: null }),
    ).toEqual({ tracked: false, reason: "not_supported" });

    expect(
      await pexelsProvider.trackDownload({ downloadLocation: undefined }),
    ).toEqual({ tracked: false, reason: "not_supported" });
  });

  it("does NOT make any fetch call when invoked", async () => {
    const fetchImpl = vi.fn();
    await pexelsProvider.trackDownload({
      downloadLocation: "https://example.com/whatever",
      fetchImpl: fetchImpl as never,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
