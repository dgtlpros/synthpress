import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/services/team-policy-service", () => {
  class TeamPermissionError extends Error {
    code: "not_a_member" | "forbidden";
    action: string;
    role: string | null;
    constructor(
      code: "not_a_member" | "forbidden",
      action: string,
      role: string | null,
    ) {
      super(`Forbidden: cannot ${action}`);
      this.code = code;
      this.action = action;
      this.role = role;
    }
  }
  return {
    assertCan: vi.fn(),
    TeamPermissionError,
  };
});

// Mock the registry so each test controls which provider the action
// receives. The registry is the single integration seam — mocking
// here lets us drive both the success path and the
// `unsupported_provider` throw path without touching the Unsplash
// adapter internals (those have their own dedicated test file).
vi.mock("@/services/image-providers/registry", () => ({
  getImageProvider: vi.fn(),
  DEFAULT_IMAGE_PROVIDER_ID: "unsplash",
}));

vi.mock("@/services/image-providers/types", () => {
  class ImageSearchError extends Error {
    code: string;
    providerId: string | null;
    details?: string;
    constructor(
      code: string,
      options: { providerId?: string | null; details?: string } = {},
    ) {
      super(`image_search_error:${code}`);
      this.code = code;
      this.providerId = options.providerId ?? null;
      this.details = options.details;
    }
  }
  return { ImageSearchError };
});

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import { getImageProvider } from "@/services/image-providers/registry";
import { ImageSearchError } from "@/services/image-providers/types";
import { IMAGE_SEARCH_ERROR_COPY } from "@/lib/image-search-error-copy";
import { searchUnsplash } from "./unsplash";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdmin = vi.mocked(createAdminClient);
const mockedAssertCan = vi.mocked(assertCan);
const mockedGetProvider = vi.mocked(getImageProvider);

const mockedSearchImages = vi.fn();
const fakeProvider = {
  providerId: "unsplash",
  displayName: "Unsplash",
  searchImages: mockedSearchImages,
  trackDownload: vi.fn(),
};

function makeAuthedClient(user: { id: string } | null = { id: "u1" }) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  };
}

const SAMPLE_RESULT = {
  results: [
    {
      provider: "unsplash",
      providerPhotoId: "abc",
      description: null,
      altDescription: "Desk with laptop",
      thumbUrl: "https://images.unsplash.com/photo-abc?w=200",
      regularUrl: "https://images.unsplash.com/photo-abc?w=1080",
      fullUrl: null,
      photographerName: "Annie Spratt",
      photographerProfileUrl: "https://unsplash.com/@anniespratt",
      photoUrl: "https://unsplash.com/photos/abc",
      downloadLocation: "https://api.unsplash.com/photos/abc/download",
    },
  ],
  totalResults: 1,
  totalPages: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(makeAuthedClient() as never);
  mockedCreateAdmin.mockReturnValue({} as never);
  mockedAssertCan.mockResolvedValue("owner" as never);
  mockedGetProvider.mockReturnValue(fakeProvider as never);
  mockedSearchImages.mockResolvedValue(SAMPLE_RESULT);
});

describe("searchUnsplash", () => {
  it("rejects an empty query without contacting Supabase", async () => {
    const result = await searchUnsplash("t1", { query: "" });
    expect(result.error).toBe(IMAGE_SEARCH_ERROR_COPY.query_required);
    expect(mockedCreateClient).not.toHaveBeenCalled();
    expect(mockedSearchImages).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only query", async () => {
    const result = await searchUnsplash("t1", { query: "   " });
    expect(result.error).toBe(IMAGE_SEARCH_ERROR_COPY.query_required);
  });

  it("rejects a non-string query (defensive)", async () => {
    const result = await searchUnsplash("t1", {
      query: undefined as unknown as string,
    });
    expect(result.error).toBe(IMAGE_SEARCH_ERROR_COPY.query_required);
  });

  it("rejects unauthenticated callers", async () => {
    mockedCreateClient.mockResolvedValue(makeAuthedClient(null) as never);

    const result = await searchUnsplash("t1", { query: "cats" });
    expect(result.error).toBe("You must be signed in.");
    expect(mockedAssertCan).not.toHaveBeenCalled();
    expect(mockedSearchImages).not.toHaveBeenCalled();
  });

  it("checks manage_blog permission before calling the provider", async () => {
    await searchUnsplash("t1", { query: "cats" });
    expect(mockedAssertCan).toHaveBeenCalledWith(
      "t1",
      "u1",
      "manage_blog",
      expect.anything(),
    );
  });

  it("translates a TeamPermissionError into its code", async () => {
    mockedAssertCan.mockRejectedValueOnce(
      new TeamPermissionError("forbidden", "manage_blog", "viewer" as never),
    );

    const result = await searchUnsplash("t1", { query: "cats" });
    expect(result.error).toBe("forbidden");
    expect(mockedSearchImages).not.toHaveBeenCalled();
  });

  it("defaults to the unsplash provider when providerId is omitted", async () => {
    await searchUnsplash("t1", { query: "smart home" });
    expect(mockedGetProvider).toHaveBeenCalledWith("unsplash");
  });

  it("forwards an explicit providerId to the registry", async () => {
    await searchUnsplash("t1", { query: "smart home", providerId: "pexels" });
    expect(mockedGetProvider).toHaveBeenCalledWith("pexels");
  });

  it("forwards query + page to the provider and returns the normalized result", async () => {
    const result = await searchUnsplash("t1", { query: "smart home", page: 2 });
    expect(mockedSearchImages).toHaveBeenCalledWith({
      query: "smart home",
      page: 2,
    });
    expect(result).toEqual({ data: SAMPLE_RESULT, error: null });
  });

  it("translates ImageSearchError(rate_limited) into the friendly copy", async () => {
    mockedSearchImages.mockRejectedValueOnce(
      new ImageSearchError("rate_limited"),
    );
    const result = await searchUnsplash("t1", { query: "cats" });
    expect(result.error).toBe(IMAGE_SEARCH_ERROR_COPY.rate_limited);
  });

  it("translates ImageSearchError(missing_access_key) into the friendly copy", async () => {
    mockedSearchImages.mockRejectedValueOnce(
      new ImageSearchError("missing_access_key"),
    );
    const result = await searchUnsplash("t1", { query: "cats" });
    expect(result.error).toBe(IMAGE_SEARCH_ERROR_COPY.missing_access_key);
  });

  it("translates ImageSearchError(request_failed)", async () => {
    mockedSearchImages.mockRejectedValueOnce(
      new ImageSearchError("request_failed", { details: "401 Unauthorized" }),
    );
    const result = await searchUnsplash("t1", { query: "cats" });
    expect(result.error).toBe(IMAGE_SEARCH_ERROR_COPY.request_failed);
  });

  it("translates ImageSearchError(invalid_response)", async () => {
    mockedSearchImages.mockRejectedValueOnce(
      new ImageSearchError("invalid_response"),
    );
    const result = await searchUnsplash("t1", { query: "cats" });
    expect(result.error).toBe(IMAGE_SEARCH_ERROR_COPY.invalid_response);
  });

  it("translates ImageSearchError(unsupported_provider) thrown by the registry lookup", async () => {
    mockedGetProvider.mockImplementationOnce(() => {
      throw new ImageSearchError("unsupported_provider", {
        providerId: "made-up",
      });
    });
    const result = await searchUnsplash("t1", {
      query: "cats",
      providerId: "made-up",
    });
    expect(result.error).toBe(IMAGE_SEARCH_ERROR_COPY.unsupported_provider);
    expect(mockedSearchImages).not.toHaveBeenCalled();
  });

  it("falls through to the underlying message for unknown thrown Errors", async () => {
    mockedSearchImages.mockRejectedValueOnce(new Error("network down"));
    const result = await searchUnsplash("t1", { query: "cats" });
    expect(result.error).toBe("network down");
  });

  it("falls through to a generic message for unknown non-Error throws", async () => {
    mockedSearchImages.mockRejectedValueOnce("oops");
    const result = await searchUnsplash("t1", { query: "cats" });
    expect(result.error).toBe("Image search failed.");
  });
});
