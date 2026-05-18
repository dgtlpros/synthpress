import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchUnsplashPhotos, UnsplashSearchError } from "./unsplash-service";

/**
 * Builds a fake `Response`-shaped object the helper can consume.
 * We avoid `new Response()` because the global `Response` constructor
 * isn't always polyfilled the same way across environments — a hand-
 * rolled object lets us be explicit about which methods the helper
 * actually calls.
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

const SAMPLE_PHOTO = {
  id: "abc",
  description: "A modern home office",
  alt_description: "Desk with laptop and plant",
  urls: {
    thumb: "https://images.unsplash.com/photo-abc?w=200",
    small: "https://images.unsplash.com/photo-abc?w=400",
    regular: "https://images.unsplash.com/photo-abc?w=1080",
    full: "https://images.unsplash.com/photo-abc",
  },
  links: {
    html: "https://unsplash.com/photos/abc",
    download_location: "https://api.unsplash.com/photos/abc/download",
  },
  user: {
    name: "Annie Spratt",
    username: "anniespratt",
    links: { html: "https://unsplash.com/@anniespratt" },
  },
};

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

describe("searchUnsplashPhotos — input validation", () => {
  it("throws query_required for an empty query", async () => {
    await expect(
      searchUnsplashPhotos({ query: "", fetchImpl: vi.fn() as never }),
    ).rejects.toMatchObject({ code: "query_required" });
  });

  it("throws query_required for a whitespace-only query", async () => {
    await expect(
      searchUnsplashPhotos({ query: "   ", fetchImpl: vi.fn() as never }),
    ).rejects.toMatchObject({ code: "query_required" });
  });

  it("throws missing_access_key when the env var is unset", async () => {
    delete process.env.UNSPLASH_ACCESS_KEY;
    await expect(
      searchUnsplashPhotos({ query: "cats", fetchImpl: vi.fn() as never }),
    ).rejects.toMatchObject({ code: "missing_access_key" });
  });

  it("throws missing_access_key when the env var is empty string", async () => {
    process.env.UNSPLASH_ACCESS_KEY = "";
    await expect(
      searchUnsplashPhotos({ query: "cats", fetchImpl: vi.fn() as never }),
    ).rejects.toMatchObject({ code: "missing_access_key" });
  });

  it("accepts an injected accessKey override", async () => {
    delete process.env.UNSPLASH_ACCESS_KEY;
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [], total: 0, total_pages: 0 } }),
      );
    await searchUnsplashPhotos({
      query: "cats",
      accessKey: "override-key",
      fetchImpl: fetchImpl as never,
    });
    const callArgs = fetchImpl.mock.calls[0]!;
    expect(callArgs[1].headers.Authorization).toBe("Client-ID override-key");
  });
});

describe("searchUnsplashPhotos — request shape", () => {
  it("hits /search/photos with the query, default page=1, default per_page=12, landscape orientation", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [], total: 0, total_pages: 0 } }),
      );
    await searchUnsplashPhotos({
      query: "smart home cameras",
      fetchImpl: fetchImpl as never,
    });

    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.origin).toBe("https://api.unsplash.com");
    expect(url.pathname).toBe("/search/photos");
    expect(url.searchParams.get("query")).toBe("smart home cameras");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("per_page")).toBe("12");
    expect(url.searchParams.get("orientation")).toBe("landscape");
  });

  it("trims the query before sending", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [], total: 0, total_pages: 0 } }),
      );
    await searchUnsplashPhotos({
      query: "  cats  ",
      fetchImpl: fetchImpl as never,
    });
    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.searchParams.get("query")).toBe("cats");
  });

  it("uses Client-ID auth (NOT Bearer) and pins the API version", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [], total: 0, total_pages: 0 } }),
      );
    await searchUnsplashPhotos({
      query: "cats",
      fetchImpl: fetchImpl as never,
    });
    const headers = fetchImpl.mock.calls[0]![1].headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe("Client-ID test-access-key");
    expect(headers["Accept-Version"]).toBe("v1");
    expect(headers.Accept).toBe("application/json");
  });

  it("respects a custom page number", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [], total: 0, total_pages: 0 } }),
      );
    await searchUnsplashPhotos({
      query: "cats",
      page: 3,
      fetchImpl: fetchImpl as never,
    });
    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.searchParams.get("page")).toBe("3");
  });

  it("clamps page < 1 to page=1", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [], total: 0, total_pages: 0 } }),
      );
    await searchUnsplashPhotos({
      query: "cats",
      page: 0,
      fetchImpl: fetchImpl as never,
    });
    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.searchParams.get("page")).toBe("1");
  });

  it("respects a custom perPage", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [], total: 0, total_pages: 0 } }),
      );
    await searchUnsplashPhotos({
      query: "cats",
      perPage: 6,
      fetchImpl: fetchImpl as never,
    });
    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.searchParams.get("per_page")).toBe("6");
  });

  it("caps perPage at 30 (Unsplash's hard limit)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [], total: 0, total_pages: 0 } }),
      );
    await searchUnsplashPhotos({
      query: "cats",
      perPage: 100,
      fetchImpl: fetchImpl as never,
    });
    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.searchParams.get("per_page")).toBe("30");
  });

  it("clamps perPage < 1 to perPage=1", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [], total: 0, total_pages: 0 } }),
      );
    await searchUnsplashPhotos({
      query: "cats",
      perPage: 0,
      fetchImpl: fetchImpl as never,
    });
    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.searchParams.get("per_page")).toBe("1");
  });

  it("falls back to globalThis.fetch when no fetchImpl is provided", async () => {
    const realFetch = globalThis.fetch;
    const stubbed = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [], total: 0, total_pages: 0 } }),
      );
    globalThis.fetch = stubbed as never;
    try {
      await searchUnsplashPhotos({ query: "cats" });
      expect(stubbed).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("searchUnsplashPhotos — response normalization", () => {
  it("maps a full Unsplash photo into the normalized shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: { results: [SAMPLE_PHOTO], total: 1, total_pages: 1 },
      }),
    );
    const result = await searchUnsplashPhotos({
      query: "office",
      fetchImpl: fetchImpl as never,
    });

    expect(result).toEqual({
      results: [
        {
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
        },
      ],
      totalResults: 1,
      totalPages: 1,
    });
  });

  it("falls back to username when name is missing", async () => {
    const photo = {
      ...SAMPLE_PHOTO,
      user: {
        name: null,
        username: "fallback-user",
        links: SAMPLE_PHOTO.user.links,
      },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [photo], total: 1, total_pages: 1 } }),
      );
    const result = await searchUnsplashPhotos({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results[0]!.photographerName).toBe("fallback-user");
  });

  it("falls back to a generic 'Unsplash photographer' when name + username are blank", async () => {
    const photo = {
      ...SAMPLE_PHOTO,
      user: { name: "   ", username: "", links: SAMPLE_PHOTO.user.links },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [photo], total: 1, total_pages: 1 } }),
      );
    const result = await searchUnsplashPhotos({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results[0]!.photographerName).toBe("Unsplash photographer");
  });

  it("falls back to https://unsplash.com when photographer profile / photo links are missing", async () => {
    const photo = {
      ...SAMPLE_PHOTO,
      links: { html: null, download_location: null },
      user: { name: "X", username: "x", links: { html: null } },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [photo], total: 1, total_pages: 1 } }),
      );
    const result = await searchUnsplashPhotos({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results[0]!.photographerProfileUrl).toBe(
      "https://unsplash.com",
    );
    expect(result.results[0]!.photoUrl).toBe("https://unsplash.com");
    expect(result.results[0]!.downloadLocation).toBeUndefined();
  });

  it("omits fullUrl when the response doesn't include urls.full", async () => {
    const photo = {
      ...SAMPLE_PHOTO,
      urls: { ...SAMPLE_PHOTO.urls, full: null },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [photo], total: 1, total_pages: 1 } }),
      );
    const result = await searchUnsplashPhotos({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results[0]!.fullUrl).toBeUndefined();
  });

  it("preserves null description / altDescription", async () => {
    const photo = {
      ...SAMPLE_PHOTO,
      description: null,
      alt_description: null,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [photo], total: 1, total_pages: 1 } }),
      );
    const result = await searchUnsplashPhotos({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results[0]!.description).toBeNull();
    expect(result.results[0]!.altDescription).toBeNull();
  });

  it("filters out rows that are missing id / thumb / regular instead of throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: {
          results: [
            SAMPLE_PHOTO,
            { ...SAMPLE_PHOTO, id: null }, // dropped
            { ...SAMPLE_PHOTO, urls: { ...SAMPLE_PHOTO.urls, thumb: null } }, // dropped
            { ...SAMPLE_PHOTO, urls: { ...SAMPLE_PHOTO.urls, regular: null } }, // dropped
            "not an object", // dropped
            null, // dropped
          ],
          total: 6,
          total_pages: 1,
        },
      }),
    );
    const result = await searchUnsplashPhotos({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.id).toBe("abc");
  });

  it("treats non-numeric total / total_pages as 0", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        json: {
          results: [SAMPLE_PHOTO],
          total: "bogus",
          total_pages: null,
        },
      }),
    );
    const result = await searchUnsplashPhotos({
      query: "x",
      fetchImpl: fetchImpl as never,
    });
    expect(result.totalResults).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it("returns an empty results array when Unsplash returns 0 hits", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ json: { results: [], total: 0, total_pages: 0 } }),
      );
    const result = await searchUnsplashPhotos({
      query: "asdfghjklqwerty",
      fetchImpl: fetchImpl as never,
    });
    expect(result.results).toEqual([]);
    expect(result.totalResults).toBe(0);
  });
});

describe("searchUnsplashPhotos — error handling", () => {
  it("translates fetch network errors to unsplash_request_failed", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(
      searchUnsplashPhotos({ query: "x", fetchImpl: fetchImpl as never }),
    ).rejects.toMatchObject({
      code: "unsplash_request_failed",
      details: "ECONNRESET",
    });
  });

  it("translates non-Error fetch failures to unsplash_request_failed with default detail", async () => {
    const fetchImpl = vi.fn().mockRejectedValue("oops");
    await expect(
      searchUnsplashPhotos({ query: "x", fetchImpl: fetchImpl as never }),
    ).rejects.toMatchObject({
      code: "unsplash_request_failed",
      details: "network_error",
    });
  });

  it("translates HTTP 429 into rate_limited", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({
          status: 429,
          ok: false,
          statusText: "Too Many Requests",
        }),
      );
    await expect(
      searchUnsplashPhotos({ query: "x", fetchImpl: fetchImpl as never }),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("translates other non-2xx into unsplash_request_failed with status text + truncated body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        status: 401,
        ok: false,
        statusText: "Unauthorized",
        text: '{"errors":["bad key"]}',
      }),
    );
    await expect(
      searchUnsplashPhotos({ query: "x", fetchImpl: fetchImpl as never }),
    ).rejects.toMatchObject({
      code: "unsplash_request_failed",
      details: expect.stringContaining("401 Unauthorized"),
    });
  });

  it("treats failure to read the error body as still an unsplash_request_failed", async () => {
    const res = makeResponse({
      status: 502,
      ok: false,
      statusText: "Bad Gateway",
    });
    (res.text as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("body read failed"),
    );
    const fetchImpl = vi.fn().mockResolvedValue(res);
    await expect(
      searchUnsplashPhotos({ query: "x", fetchImpl: fetchImpl as never }),
    ).rejects.toMatchObject({
      code: "unsplash_request_failed",
      details: expect.stringContaining("502 Bad Gateway"),
    });
  });

  it("translates JSON parse errors into unsplash_invalid_response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ jsonThrows: new Error("Unexpected token") }),
      );
    await expect(
      searchUnsplashPhotos({ query: "x", fetchImpl: fetchImpl as never }),
    ).rejects.toMatchObject({
      code: "unsplash_invalid_response",
      details: "Unexpected token",
    });
  });

  it("uses the default 'invalid_json' detail when JSON parse throws non-Error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ jsonThrows: "nope" as never }));
    await expect(
      searchUnsplashPhotos({ query: "x", fetchImpl: fetchImpl as never }),
    ).rejects.toMatchObject({
      code: "unsplash_invalid_response",
      details: "invalid_json",
    });
  });

  it("rejects responses that aren't an object", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse({ json: "hi" }));
    await expect(
      searchUnsplashPhotos({ query: "x", fetchImpl: fetchImpl as never }),
    ).rejects.toMatchObject({ code: "unsplash_invalid_response" });
  });

  it("rejects responses without a results array", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ json: { total: 0, total_pages: 0 } }));
    await expect(
      searchUnsplashPhotos({ query: "x", fetchImpl: fetchImpl as never }),
    ).rejects.toMatchObject({
      code: "unsplash_invalid_response",
      details: "missing results array",
    });
  });
});

describe("UnsplashSearchError", () => {
  it("captures code + details on the message", () => {
    const e = new UnsplashSearchError("rate_limited", "test");
    expect(e.code).toBe("rate_limited");
    expect(e.details).toBe("test");
    expect(e.message).toContain("rate_limited");
    expect(e.message).toContain("test");
  });

  it("renders without details when none provided", () => {
    const e = new UnsplashSearchError("query_required");
    expect(e.message).toBe("unsplash_search_error:query_required");
  });
});
