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

vi.mock("@/services/article-image-upload-service", () => ({
  listRecentImageUploadsForBlog: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import { listRecentImageUploadsForBlog } from "@/services/article-image-upload-service";
import { getRecentBlogImageUploads } from "./article-images";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdmin = vi.mocked(createAdminClient);
const mockedAssertCan = vi.mocked(assertCan);
const mockedListRecent = vi.mocked(listRecentImageUploadsForBlog);

function makeAuthedClient(user: { id: string } | null = { id: "u1" }) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  };
}

const SAMPLE_ROW = {
  id: "row-1",
  article_id: "a1",
  blog_id: "b1",
  provider: "unsplash",
  provider_photo_id: "abc",
  image_url: "https://images.unsplash.com/photo-abc?w=1080",
  alt_text: "Desk with laptop",
  photographer_name: "Annie Spratt",
  photographer_profile_url: "https://unsplash.com/@anniespratt",
  photo_url: "https://unsplash.com/photos/abc",
  download_location: "https://api.unsplash.com/photos/abc/download",
  wp_media_id: 99,
  role: "featured",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(makeAuthedClient() as never);
  mockedCreateAdmin.mockReturnValue({} as never);
  mockedAssertCan.mockResolvedValue("owner" as never);
  mockedListRecent.mockResolvedValue([SAMPLE_ROW] as never);
});

describe("getRecentBlogImageUploads", () => {
  it("rejects unauthenticated callers", async () => {
    mockedCreateClient.mockResolvedValue(makeAuthedClient(null) as never);

    const result = await getRecentBlogImageUploads("t1", "b1");
    expect(result.error).toBe("You must be signed in.");
    expect(mockedAssertCan).not.toHaveBeenCalled();
    expect(mockedListRecent).not.toHaveBeenCalled();
  });

  it("checks manage_blog before listing", async () => {
    await getRecentBlogImageUploads("t1", "b1");
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
    const result = await getRecentBlogImageUploads("t1", "b1");
    expect(result.error).toBe("forbidden");
    expect(mockedListRecent).not.toHaveBeenCalled();
  });

  it("normalizes rows into the client-safe shape", async () => {
    const result = await getRecentBlogImageUploads("t1", "b1");
    expect(result.data).toEqual([
      {
        id: "row-1",
        imageUrl: SAMPLE_ROW.image_url,
        altText: "Desk with laptop",
        provider: "unsplash",
        providerPhotoId: "abc",
        photographerName: "Annie Spratt",
        photographerProfileUrl: "https://unsplash.com/@anniespratt",
        photoUrl: "https://unsplash.com/photos/abc",
        downloadLocation: SAMPLE_ROW.download_location,
        wpMediaId: 99,
      },
    ]);
  });

  it("returns an empty array when there are no recent uploads", async () => {
    mockedListRecent.mockResolvedValueOnce([] as never);
    const result = await getRecentBlogImageUploads("t1", "b1");
    expect(result).toEqual({ data: [], error: null });
  });

  it("falls through to the underlying message for unknown thrown Errors", async () => {
    mockedListRecent.mockRejectedValueOnce(new Error("db down"));
    const result = await getRecentBlogImageUploads("t1", "b1");
    expect(result.error).toBe("db down");
  });

  it("falls through to a generic message for unknown non-Error throws", async () => {
    mockedListRecent.mockRejectedValueOnce("oops");
    const result = await getRecentBlogImageUploads("t1", "b1");
    expect(result.error).toBe("Could not load recent images.");
  });
});
