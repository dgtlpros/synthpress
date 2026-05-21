import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BLOG_SETTINGS } from "@/lib/blog-settings";
import {
  buildWordPressCategoriesEndpoint,
  buildWordPressTagsEndpoint,
  buildWordPressUsersEndpoint,
  resolvePublishingMetaForPost,
  resolveWordPressAuthorId,
  resolveWordPressCategoryId,
  resolveWordPressTagIds,
} from "./wordpress-publishing-defaults";

describe("wordpress taxonomy endpoints", () => {
  it("builds categories, tags, and users REST paths", () => {
    expect(buildWordPressCategoriesEndpoint("https://example.com/")).toBe(
      "https://example.com/wp-json/wp/v2/categories",
    );
    expect(buildWordPressCategoriesEndpoint("https://example.com/", 3)).toBe(
      "https://example.com/wp-json/wp/v2/categories/3",
    );
    expect(buildWordPressTagsEndpoint("https://example.com", 5)).toBe(
      "https://example.com/wp-json/wp/v2/tags/5",
    );
    expect(buildWordPressUsersEndpoint("https://example.com")).toBe(
      "https://example.com/wp-json/wp/v2/users",
    );
    expect(buildWordPressUsersEndpoint("https://example.com", 12)).toBe(
      "https://example.com/wp-json/wp/v2/users/12",
    );
  });
});

describe("resolveWordPressCategoryId", () => {
  it("returns an existing category id from search results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 4, name: "Blog", slug: "blog" }],
    });

    const id = await resolveWordPressCategoryId(
      "blog",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBe(4);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("matches category by display name when slug differs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 11, name: "Blog", slug: "other-slug" }],
    });

    const id = await resolveWordPressCategoryId(
      "blog",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBe(11);
  });

  it("creates a category when search returns no match", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 9, name: "New Cat" }),
      });

    const id = await resolveWordPressCategoryId(
      "New Cat",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBe(9);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]![1]?.method).toBe("POST");
  });

  it("returns null for empty names", async () => {
    const fetchImpl = vi.fn();
    expect(
      await resolveWordPressCategoryId(
        "  ",
        "https://example.com",
        "Basic x",
        fetchImpl as never,
      ),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when search fails and create throws", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockRejectedValueOnce(new Error("network"));

    const id = await resolveWordPressCategoryId(
      "Ops",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBeNull();
  });

  it("returns null when search response is not an array", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ not: "array" }),
    });

    const id = await resolveWordPressCategoryId(
      "Ops",
      "https://example.com/",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBeNull();
  });

  it("returns null when the search fetch throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));

    const id = await resolveWordPressCategoryId(
      "Ops",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBeNull();
  });

  it("returns null when create response is not ok", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });

    const id = await resolveWordPressCategoryId(
      "New",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBeNull();
  });

  it("returns null when create response body is not an object", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => "bad" });

    const id = await resolveWordPressCategoryId(
      "New",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBeNull();
  });

  it("returns null when create response has no valid id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "nope" }) });

    const id = await resolveWordPressCategoryId(
      "New",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBeNull();
  });

  it("matches by slug when name is missing on the taxonomy row", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 12, slug: "blog", name: null }],
    });

    const id = await resolveWordPressCategoryId(
      "blog",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBe(12);
  });

  it("matches by name when slug is missing on the taxonomy row", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 13, slug: null, name: "Blog" }],
    });

    const id = await resolveWordPressCategoryId(
      "blog",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBe(13);
  });

  it("ignores malformed taxonomy rows when searching", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          null,
          { id: 0 },
          { id: 6, name: "Target", slug: "target" },
        ],
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 6 }) });

    const id = await resolveWordPressCategoryId(
      "target",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBe(6);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("resolveWordPressTagIds", () => {
  it("resolves multiple tags and dedupes ids", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("search=ai")) {
        return {
          ok: true,
          json: async () => [{ id: 1, name: "ai", slug: "ai" }],
        };
      }
      if (url.includes("search=ml")) {
        return {
          ok: true,
          json: async () => [{ id: 2, name: "ml", slug: "ml" }],
        };
      }
      return { ok: true, json: async () => [] };
    });

    const ids = await resolveWordPressTagIds(
      ["ai", "ml"],
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(ids).toEqual([1, 2]);
  });

  it("creates a tag when search returns no match", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 7, name: "new-tag" }),
      });

    const ids = await resolveWordPressTagIds(
      ["new-tag"],
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(ids).toEqual([7]);
    expect(fetchImpl.mock.calls[1]![1]?.method).toBe("POST");
  });

  it("skips empty tag strings and tags that fail to resolve", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => [] });

    const ids = await resolveWordPressTagIds(
      ["  ", "ghost"],
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(ids).toEqual([]);
  });
});

describe("resolveWordPressAuthorId", () => {
  it("prefers slug lookup", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 42, slug: "editor", name: "Editor" }],
    });

    const id = await resolveWordPressAuthorId(
      "editor",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBe(42);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("slug=editor");
  });

  it("falls back to search when slug lookup returns no usable id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 0, slug: "editor", name: "Editor" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 99, slug: "bob", name: "Bob" }],
      });

    const id = await resolveWordPressAuthorId(
      "bob",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBe(99);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]![0])).toContain("search=bob");
  });

  it("returns null when slug and search lookups fail", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: false, json: async () => [] });

    const id = await resolveWordPressAuthorId(
      "missing",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBeNull();
  });

  it("matches author by display name when slug differs", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 77, slug: "other", name: "Bob" }],
      });

    const id = await resolveWordPressAuthorId(
      "bob",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBe(77);
  });

  it("returns null when search returns users but none match the login", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 3, slug: "other", name: "Other User" }],
      });

    const id = await resolveWordPressAuthorId(
      "target",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBeNull();
  });

  it("skips malformed user rows during search", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          null,
          { id: 0 },
          { id: 50, slug: null, name: null },
          { id: 51, slug: "bob", name: null },
        ],
      });

    const id = await resolveWordPressAuthorId(
      "bob",
      "https://example.com",
      "Basic x",
      fetchImpl as never,
    );

    expect(id).toBe(51);
  });

  it("returns null for empty author login", async () => {
    const fetchImpl = vi.fn();
    expect(
      await resolveWordPressAuthorId(
        "  ",
        "https://example.com",
        "Basic x",
        fetchImpl as never,
      ),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("resolvePublishingMetaForPost", () => {
  it("aggregates category, tag, and author resolution", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/categories?")) {
        return {
          ok: true,
          json: async () => [{ id: 3, name: "Tech", slug: "tech" }],
        };
      }
      if (url.includes("/tags?")) {
        return {
          ok: true,
          json: async () => [{ id: 8, name: "ai", slug: "ai" }],
        };
      }
      if (url.includes("/users?")) {
        return {
          ok: true,
          json: async () => [{ id: 5, slug: "alice", name: "alice" }],
        };
      }
      if (init?.method === "POST") {
        return { ok: true, json: async () => ({ id: 1 }) };
      }
      return { ok: false, json: async () => [] };
    });

    const meta = await resolvePublishingMetaForPost({
      wpUrl: "https://example.com",
      auth: "Basic x",
      publishing: {
        ...DEFAULT_BLOG_SETTINGS.publishing,
        defaultCategory: "Tech",
        defaultTags: ["ai"],
        defaultAuthor: "alice",
      },
      fetchImpl: fetchImpl as never,
    });

    expect(meta).toEqual({
      categoryIds: [3],
      tagIds: [8],
      authorId: 5,
    });
  });

  it("returns empty meta when publishing defaults are blank", async () => {
    const fetchImpl = vi.fn();

    const meta = await resolvePublishingMetaForPost({
      wpUrl: "https://example.com",
      auth: "Basic x",
      publishing: DEFAULT_BLOG_SETTINGS.publishing,
      fetchImpl: fetchImpl as never,
    });

    expect(meta).toEqual({ categoryIds: [], tagIds: [], authorId: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses global fetch when fetchImpl is omitted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [{ id: 2, name: "News", slug: "news" }],
    } as Response);

    try {
      const meta = await resolvePublishingMetaForPost({
        wpUrl: "https://example.com",
        auth: "Basic x",
        publishing: {
          ...DEFAULT_BLOG_SETTINGS.publishing,
          defaultCategory: "News",
        },
      });

      expect(meta.categoryIds).toEqual([2]);
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("buildWordPressPayload publishing meta", () => {
  it("adds categories, tags, and author when provided", async () => {
    const { buildWordPressPayload: buildPayload } =
      await import("./wordpress-publish-service");

    const payload = buildPayload(
      {
        id: "a1",
        title: "T",
        slug: "t",
        excerpt: "",
        content_markdown: "# x",
        meta_description: null,
        target_keyword: null,
        blog_id: "b1",
        wp_post_id: null,
        featured_image_url: null,
        featured_image_alt: null,
        wp_featured_media_id: null,
      },
      "<p>x</p>",
      "draft",
      null,
      { categoryIds: [2], tagIds: [3, 4], authorId: 9 },
    );

    expect(payload.categories).toEqual([2]);
    expect(payload.tags).toEqual([3, 4]);
    expect(payload.author).toBe(9);
  });
});
