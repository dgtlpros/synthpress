import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ARTICLE_CONTENT_MAX,
  ARTICLE_EXCERPT_MAX,
  ARTICLE_FEATURED_IMAGE_ALT_MAX,
  ARTICLE_FEATURED_IMAGE_URL_MAX,
  ARTICLE_META_DESCRIPTION_MAX,
  ARTICLE_SLUG_MAX,
  ARTICLE_TARGET_KEYWORD_MAX,
  ARTICLE_TITLE_MAX,
  type ArticleEditableFields,
  getArticleByIdForBlog,
  getArticleIdsByIdeaIds,
  transitionArticleStatusOnEdit,
  updateArticleFields,
  validateArticleEdit,
} from "./article-service";

const mockedCreateAdmin = vi.mocked(createAdminClient);

interface ChainResult<T> {
  data: T;
  error: { code?: string; message?: string } | null;
}

function makeChain<T>(result: ChainResult<T>) {
  // `order` is intentionally a chainable-AND-thenable hybrid: many
  // existing queries terminate at `.order(...)` and `await` the
  // result, while `listSectionImageRowsForArticle` chains
  // `.order(...).order(...)`. We satisfy both by returning `this`
  // from `order` AND making the chain itself thenable to the
  // canned result.
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    then: ((onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected)) as PromiseLike<
      ChainResult<T>
    >["then"],
  };
  return chain;
}

interface MockClient {
  from: ReturnType<typeof vi.fn>;
  __chains: Record<string, ReturnType<typeof makeChain>>;
}

function makeClient(table: Record<string, ChainResult<unknown>>): MockClient {
  const chains: Record<string, ReturnType<typeof makeChain>> = {};
  for (const [name, result] of Object.entries(table)) {
    chains[name] = makeChain(result);
  }
  const client = {
    from: vi.fn((name: string) => {
      if (!chains[name]) chains[name] = makeChain({ data: null, error: null });
      return chains[name];
    }),
    __chains: chains,
  };
  return client as unknown as MockClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

const baseFields: ArticleEditableFields = {
  title: "How to launch a B2B blog",
  slug: "how-to-launch-a-b2b-blog",
  excerpt: "A practical 30-day plan.",
  metaDescription: "Step-by-step playbook for launching a B2B blog in 30 days.",
  targetKeyword: "launch b2b blog",
  contentMarkdown: "# heading\n\nA paragraph.",
  featuredImageUrl: null,
  featuredImageAlt: null,
};

// ============================================================================
// validateArticleEdit
// ============================================================================

describe("validateArticleEdit", () => {
  it("accepts valid input", () => {
    expect(validateArticleEdit(baseFields)).toBeNull();
  });

  it("rejects an empty title (after trim)", () => {
    expect(validateArticleEdit({ ...baseFields, title: "   " })).toBe(
      "title_required",
    );
  });

  it("rejects an over-long title", () => {
    expect(
      validateArticleEdit({
        ...baseFields,
        title: "x".repeat(ARTICLE_TITLE_MAX + 1),
      }),
    ).toBe("title_too_long");
  });

  it("rejects an over-long slug", () => {
    expect(
      validateArticleEdit({
        ...baseFields,
        slug: "x".repeat(ARTICLE_SLUG_MAX + 1),
      }),
    ).toBe("slug_too_long");
  });

  it("rejects a malformed slug", () => {
    expect(validateArticleEdit({ ...baseFields, slug: "Has Spaces" })).toBe(
      "slug_invalid",
    );
  });

  it("allows an empty / null slug", () => {
    expect(validateArticleEdit({ ...baseFields, slug: "" })).toBeNull();
    expect(validateArticleEdit({ ...baseFields, slug: null })).toBeNull();
  });

  it("rejects an over-long excerpt", () => {
    expect(
      validateArticleEdit({
        ...baseFields,
        excerpt: "x".repeat(ARTICLE_EXCERPT_MAX + 1),
      }),
    ).toBe("excerpt_too_long");
  });

  it("rejects an over-long meta description", () => {
    expect(
      validateArticleEdit({
        ...baseFields,
        metaDescription: "x".repeat(ARTICLE_META_DESCRIPTION_MAX + 1),
      }),
    ).toBe("meta_description_too_long");
  });

  it("rejects an over-long target keyword", () => {
    expect(
      validateArticleEdit({
        ...baseFields,
        targetKeyword: "x".repeat(ARTICLE_TARGET_KEYWORD_MAX + 1),
      }),
    ).toBe("target_keyword_too_long");
  });

  it("rejects an over-long Markdown body", () => {
    expect(
      validateArticleEdit({
        ...baseFields,
        contentMarkdown: "x".repeat(ARTICLE_CONTENT_MAX + 1),
      }),
    ).toBe("content_too_long");
  });

  it("accepts a null featured image URL (no image)", () => {
    expect(
      validateArticleEdit({ ...baseFields, featuredImageUrl: null }),
    ).toBeNull();
  });

  it("accepts an empty featured image URL (treated as no image)", () => {
    expect(
      validateArticleEdit({ ...baseFields, featuredImageUrl: "" }),
    ).toBeNull();
  });

  it("accepts an http URL", () => {
    expect(
      validateArticleEdit({
        ...baseFields,
        featuredImageUrl: "http://example.com/img.jpg",
      }),
    ).toBeNull();
  });

  it("accepts an https URL", () => {
    expect(
      validateArticleEdit({
        ...baseFields,
        featuredImageUrl: "https://example.com/img.jpg",
      }),
    ).toBeNull();
  });

  it("rejects a featured image URL that is not http(s)", () => {
    expect(
      validateArticleEdit({
        ...baseFields,
        featuredImageUrl: "javascript:alert(1)",
      }),
    ).toBe("featured_image_url_invalid");
    expect(
      validateArticleEdit({
        ...baseFields,
        featuredImageUrl: "data:image/png;base64,abcd",
      }),
    ).toBe("featured_image_url_invalid");
    expect(
      validateArticleEdit({
        ...baseFields,
        featuredImageUrl: "/relative/path.jpg",
      }),
    ).toBe("featured_image_url_invalid");
    expect(
      validateArticleEdit({
        ...baseFields,
        featuredImageUrl: "not a url at all",
      }),
    ).toBe("featured_image_url_invalid");
  });

  it("rejects an over-long featured image URL", () => {
    expect(
      validateArticleEdit({
        ...baseFields,
        featuredImageUrl: `https://example.com/${"x".repeat(
          ARTICLE_FEATURED_IMAGE_URL_MAX,
        )}`,
      }),
    ).toBe("featured_image_url_too_long");
  });

  it("accepts a null featured image alt", () => {
    expect(
      validateArticleEdit({ ...baseFields, featuredImageAlt: null }),
    ).toBeNull();
  });

  it("rejects an over-long featured image alt", () => {
    expect(
      validateArticleEdit({
        ...baseFields,
        featuredImageAlt: "x".repeat(ARTICLE_FEATURED_IMAGE_ALT_MAX + 1),
      }),
    ).toBe("featured_image_alt_too_long");
  });
});

// ============================================================================
// transitionArticleStatusOnEdit
// ============================================================================

describe("transitionArticleStatusOnEdit", () => {
  it("keeps failed and archived statuses untouched", () => {
    expect(transitionArticleStatusOnEdit("failed")).toBe("failed");
    expect(transitionArticleStatusOnEdit("archived")).toBe("archived");
  });

  it("promotes everything else to ready_for_review", () => {
    expect(transitionArticleStatusOnEdit("draft")).toBe("ready_for_review");
    expect(transitionArticleStatusOnEdit("generating")).toBe(
      "ready_for_review",
    );
    expect(transitionArticleStatusOnEdit("ready")).toBe("ready_for_review");
    expect(transitionArticleStatusOnEdit("ready_for_review")).toBe(
      "ready_for_review",
    );
    expect(transitionArticleStatusOnEdit("scheduled")).toBe("ready_for_review");
    expect(transitionArticleStatusOnEdit("publishing")).toBe(
      "ready_for_review",
    );
    expect(transitionArticleStatusOnEdit("published")).toBe("ready_for_review");
  });
});

// ============================================================================
// getArticleByIdForBlog
// ============================================================================

describe("getArticleByIdForBlog", () => {
  it("returns the row when scoped to the blog", async () => {
    const row = { id: "a1", blog_id: "b1", title: "X" };
    const client = makeClient({
      articles: { data: row, error: null },
    });

    const result = await getArticleByIdForBlog("a1", "b1", client as never);

    expect(result).toEqual(row);
    expect(client.__chains.articles!.eq).toHaveBeenCalledWith("id", "a1");
    expect(client.__chains.articles!.eq).toHaveBeenCalledWith("blog_id", "b1");
  });

  it("returns null when no row matches", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
    });

    expect(
      await getArticleByIdForBlog("missing", "b1", client as never),
    ).toBeNull();
  });

  it("propagates supabase errors", async () => {
    const client = makeClient({
      articles: { data: null, error: { message: "boom" } },
    });

    await expect(
      getArticleByIdForBlog("a1", "b1", client as never),
    ).rejects.toEqual({ message: "boom" });
  });

  it("uses the admin client when none is injected", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await getArticleByIdForBlog("a1", "b1");
    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// updateArticleFields
// ============================================================================

describe("updateArticleFields", () => {
  it("validates input before touching the DB", async () => {
    const client = makeClient({
      articles: {
        data: { status: "ready_for_review" },
        error: null,
      },
    });

    await expect(
      updateArticleFields({
        articleId: "a1",
        blogId: "b1",
        fields: { ...baseFields, title: "" },
        client: client as never,
      }),
    ).rejects.toThrow("invalid_article_edit:title_required");

    expect(client.__chains.articles!.update).not.toHaveBeenCalled();
  });

  it("throws article_not_found when no row matches", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
    });

    await expect(
      updateArticleFields({
        articleId: "a1",
        blogId: "b1",
        fields: baseFields,
        client: client as never,
      }),
    ).rejects.toThrow("article_not_found");
  });

  it("propagates supabase errors from the read", async () => {
    const client = makeClient({
      articles: { data: null, error: { message: "read boom" } },
    });

    await expect(
      updateArticleFields({
        articleId: "a1",
        blogId: "b1",
        fields: baseFields,
        client: client as never,
      }),
    ).rejects.toEqual({ message: "read boom" });
  });

  it("writes the trimmed fields and promotes status to ready_for_review", async () => {
    const updatedRow = {
      id: "a1",
      blog_id: "b1",
      status: "ready_for_review",
      title: "Edited",
    };
    const client = makeClient({
      articles: {
        data: null,
        error: null,
      },
    });
    // Two `maybeSingle` calls in sequence:
    //   1) read existing article (returns the status row)
    //   2) slug-conflict check (returns null = no conflict)
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: "draft" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    // The .single() at the end of the update chain resolves the new row.
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: updatedRow, error: null });

    const result = await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: {
        ...baseFields,
        title: "  Edited  ",
        targetKeyword: "  launch b2b blog  ",
      },
      client: client as never,
    });

    expect(result).toEqual(updatedRow);
    expect(client.__chains.articles!.update).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Edited",
        slug: "how-to-launch-a-b2b-blog",
        target_keyword: "launch b2b blog",
        status: "ready_for_review",
      }),
    );
    // The conflict query excludes the article being edited.
    expect(client.__chains.articles!.neq).toHaveBeenCalledWith("id", "a1");
  });

  it("preserves a failed status across an edit", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
    });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: "failed" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: "failed" }, error: null });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: baseFields,
      client: client as never,
    });

    const updateArg = client.__chains.articles!.update.mock.calls[0]![0] as {
      status: string;
    };
    expect(updateArg.status).toBe("failed");
  });

  it("preserves an archived status across an edit", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
    });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: "archived" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: "archived" }, error: null });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: baseFields,
      client: client as never,
    });

    const updateArg = client.__chains.articles!.update.mock.calls[0]![0] as {
      status: string;
    };
    expect(updateArg.status).toBe("archived");
  });

  it("collapses an empty slug to null and accepts null fields", async () => {
    const client = makeClient({
      articles: { data: { status: "draft" }, error: null },
    });
    client.__chains.articles!.single = vi.fn().mockResolvedValueOnce({
      data: { id: "a1" },
      error: null,
    });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: {
        ...baseFields,
        slug: "   ",
        excerpt: null,
        metaDescription: null,
        targetKeyword: null,
        contentMarkdown: null,
      },
      client: client as never,
    });

    const updateArg = client.__chains.articles!.update.mock.calls[0]![0] as {
      slug: string | null;
      excerpt: string;
      meta_description: string | null;
      target_keyword: string | null;
      content_markdown: string | null;
    };
    expect(updateArg.slug).toBeNull();
    expect(updateArg.excerpt).toBe("");
    expect(updateArg.meta_description).toBeNull();
    expect(updateArg.target_keyword).toBeNull();
    expect(updateArg.content_markdown).toBeNull();
  });

  it("writes null when the slug field itself is null (vs. empty string)", async () => {
    const client = makeClient({
      articles: { data: { status: "draft" }, error: null },
    });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: { ...baseFields, slug: null },
      client: client as never,
    });

    expect(client.__chains.articles!.update).toHaveBeenCalledWith(
      expect.objectContaining({ slug: null }),
    );
  });

  it("propagates supabase errors from the update", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
    });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: "draft" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "write boom" } });

    await expect(
      updateArticleFields({
        articleId: "a1",
        blogId: "b1",
        fields: baseFields,
        client: client as never,
      }),
    ).rejects.toEqual({ message: "write boom" });
  });

  it("uses the admin client when none is injected", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
    });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: "draft" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: baseFields,
    });

    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });

  it("rejects when another article in the blog has the same slug", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
    });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      // existing article read
      .mockResolvedValueOnce({ data: { status: "draft" }, error: null })
      // slug conflict check finds another row
      .mockResolvedValueOnce({
        data: { id: "another-article" },
        error: null,
      });

    await expect(
      updateArticleFields({
        articleId: "a1",
        blogId: "b1",
        fields: baseFields,
        client: client as never,
      }),
    ).rejects.toThrow("slug_taken");

    // Update should NOT have been attempted.
    expect(client.__chains.articles!.update).not.toHaveBeenCalled();
  });

  it("does not flag the article being edited as its own conflict", async () => {
    // Smoke test for the .neq("id", articleId) clause: the conflict
    // query's mock returns null (=no other row with this slug) which
    // is what supabase would return given the .neq filter.
    const client = makeClient({
      articles: { data: null, error: null },
    });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: "draft" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: baseFields,
      client: client as never,
    });

    expect(client.__chains.articles!.neq).toHaveBeenCalledWith("id", "a1");
    expect(client.__chains.articles!.update).toHaveBeenCalled();
  });

  it("propagates supabase errors from the slug conflict query", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
    });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: "draft" }, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "slug query boom" },
      });

    await expect(
      updateArticleFields({
        articleId: "a1",
        blogId: "b1",
        fields: baseFields,
        client: client as never,
      }),
    ).rejects.toEqual({ message: "slug query boom" });
  });

  it("skips the slug conflict query when the slug is blank", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
    });
    // Only ONE maybeSingle call expected (the existing-read).
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: "draft" }, error: null });
    client.__chains.articles!.maybeSingle = maybeSingle;
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: { ...baseFields, slug: "   " },
      client: client as never,
    });

    expect(maybeSingle).toHaveBeenCalledTimes(1);
    expect(client.__chains.articles!.neq).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------
  // Featured image fields — persistence + clear-on-change behavior.
  // --------------------------------------------------------------

  it("persists trimmed featured_image_url + featured_image_alt", async () => {
    const client = makeClient({ articles: { data: null, error: null } });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      // existing read returns the previous URL (same as new) so the
      // wp_featured_media_id reset doesn't fire.
      .mockResolvedValueOnce({
        data: {
          status: "ready_for_review",
          featured_image_url: "https://example.com/img.jpg",
        },
        error: null,
      })
      // slug conflict check (no conflict)
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: {
        ...baseFields,
        featuredImageUrl: "  https://example.com/img.jpg  ",
        featuredImageAlt: "  A photo of a cat  ",
      },
      client: client as never,
    });

    const updateArg = client.__chains.articles!.update.mock.calls[0]![0] as {
      featured_image_url: string | null;
      featured_image_alt: string | null;
      wp_featured_media_id?: number | null;
    };
    expect(updateArg.featured_image_url).toBe("https://example.com/img.jpg");
    expect(updateArg.featured_image_alt).toBe("A photo of a cat");
    // URL didn't change, so wp_featured_media_id is NOT touched.
    expect(updateArg).not.toHaveProperty("wp_featured_media_id");
  });

  it("normalizes blank featured-image fields to null", async () => {
    const client = makeClient({ articles: { data: null, error: null } });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: { status: "draft", featured_image_url: null },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: {
        ...baseFields,
        featuredImageUrl: "   ",
        featuredImageAlt: "   ",
      },
      client: client as never,
    });

    const updateArg = client.__chains.articles!.update.mock.calls[0]![0] as {
      featured_image_url: string | null;
      featured_image_alt: string | null;
    };
    expect(updateArg.featured_image_url).toBeNull();
    expect(updateArg.featured_image_alt).toBeNull();
  });

  it("clears wp_featured_media_id when featured_image_url changes", async () => {
    const client = makeClient({ articles: { data: null, error: null } });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          status: "ready_for_review",
          featured_image_url: "https://example.com/old.jpg",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: {
        ...baseFields,
        featuredImageUrl: "https://example.com/new.jpg",
      },
      client: client as never,
    });

    const updateArg = client.__chains.articles!.update.mock.calls[0]![0] as {
      wp_featured_media_id: number | null;
      featured_image_url: string;
    };
    expect(updateArg.wp_featured_media_id).toBeNull();
    expect(updateArg.featured_image_url).toBe("https://example.com/new.jpg");
  });

  it("clears wp_featured_media_id when the user removes the featured image", async () => {
    const client = makeClient({ articles: { data: null, error: null } });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          status: "ready_for_review",
          featured_image_url: "https://example.com/old.jpg",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: { ...baseFields, featuredImageUrl: null, featuredImageAlt: null },
      client: client as never,
    });

    const updateArg = client.__chains.articles!.update.mock.calls[0]![0] as {
      wp_featured_media_id: number | null;
      featured_image_url: string | null;
    };
    expect(updateArg.wp_featured_media_id).toBeNull();
    expect(updateArg.featured_image_url).toBeNull();
  });

  it("does NOT clear wp_featured_media_id when only the alt changes", async () => {
    const client = makeClient({ articles: { data: null, error: null } });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          status: "ready_for_review",
          featured_image_url: "https://example.com/img.jpg",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: {
        ...baseFields,
        featuredImageUrl: "https://example.com/img.jpg",
        featuredImageAlt: "Updated alt text",
      },
      client: client as never,
    });

    const updateArg = client.__chains.articles!.update.mock.calls[0]![0] as {
      featured_image_alt: string | null;
      wp_featured_media_id?: number | null;
    };
    expect(updateArg.featured_image_alt).toBe("Updated alt text");
    expect(updateArg).not.toHaveProperty("wp_featured_media_id");
  });

  // --------------------------------------------------------------
  // selectedImageMetadata — attribution row + wp_media_id reuse
  // --------------------------------------------------------------

  const SAMPLE_METADATA = {
    provider: "unsplash",
    providerPhotoId: "abc",
    imageUrl: "https://example.com/new.jpg",
    altText: "Desk with laptop",
    photographerName: "Annie Spratt",
    photographerProfileUrl: "https://unsplash.com/@anniespratt",
    photoUrl: "https://unsplash.com/photos/abc",
    downloadLocation: "https://api.unsplash.com/photos/abc/download",
    wpMediaId: null,
  };

  it("inserts an article_image_uploads row when metadata + URL match the saved value", async () => {
    const client = makeClient({ articles: { data: null, error: null } });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          status: "ready_for_review",
          featured_image_url: "https://example.com/old.jpg",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });
    // Attribution insert returns a row from `.single()` on the
    // `article_image_uploads` chain.
    client.__chains.article_image_uploads = makeChain({
      data: { id: "img-row-1" },
      error: null,
    });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: {
        ...baseFields,
        featuredImageUrl: "https://example.com/new.jpg",
        featuredImageAlt: "Desk with laptop",
        selectedImageMetadata: SAMPLE_METADATA,
      },
      client: client as never,
    });

    expect(client.__chains.article_image_uploads!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        article_id: "a1",
        blog_id: "b1",
        provider: "unsplash",
        provider_photo_id: "abc",
        image_url: "https://example.com/new.jpg",
        photographer_name: "Annie Spratt",
        download_location: SAMPLE_METADATA.downloadLocation,
        role: "featured",
      }),
    );
  });

  it("does NOT insert an attribution row when metadata.imageUrl doesn't match the saved URL (stale pick)", async () => {
    const client = makeClient({ articles: { data: null, error: null } });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          status: "ready_for_review",
          featured_image_url: "https://example.com/old.jpg",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });
    client.__chains.article_image_uploads = makeChain({
      data: null,
      error: null,
    });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: {
        ...baseFields,
        // User picked a Unsplash photo, then edited the URL by hand
        // before saving. Metadata is stale — attribution row stays
        // unwritten.
        featuredImageUrl: "https://example.com/manually-pasted.jpg",
        selectedImageMetadata: SAMPLE_METADATA,
      },
      client: client as never,
    });

    expect(
      client.__chains.article_image_uploads!.insert,
    ).not.toHaveBeenCalled();
  });

  it("does NOT insert an attribution row when no selectedImageMetadata is supplied (manual paste)", async () => {
    const client = makeClient({ articles: { data: null, error: null } });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: { status: "ready_for_review", featured_image_url: null },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });
    client.__chains.article_image_uploads = makeChain({
      data: null,
      error: null,
    });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: {
        ...baseFields,
        featuredImageUrl: "https://example.com/manually-pasted.jpg",
        // selectedImageMetadata omitted entirely.
      },
      client: client as never,
    });

    expect(
      client.__chains.article_image_uploads!.insert,
    ).not.toHaveBeenCalled();
  });

  it("does NOT insert an attribution row when the user clears the featured image", async () => {
    const client = makeClient({ articles: { data: null, error: null } });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          status: "ready_for_review",
          featured_image_url: "https://example.com/old.jpg",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });
    client.__chains.article_image_uploads = makeChain({
      data: null,
      error: null,
    });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: {
        ...baseFields,
        featuredImageUrl: null,
        // Hypothetical: caller passes metadata that's now stale because
        // the URL was cleared. The save still drops the attribution row.
        selectedImageMetadata: SAMPLE_METADATA,
      },
      client: client as never,
    });

    expect(
      client.__chains.article_image_uploads!.insert,
    ).not.toHaveBeenCalled();
  });

  it("reuses wp_media_id from metadata when URL changes AND metadata matches (recently-used flow)", async () => {
    const client = makeClient({ articles: { data: null, error: null } });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          status: "ready_for_review",
          featured_image_url: "https://example.com/old.jpg",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });
    client.__chains.article_image_uploads = makeChain({
      data: { id: "img-row-2" },
      error: null,
    });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: {
        ...baseFields,
        featuredImageUrl: "https://example.com/new.jpg",
        selectedImageMetadata: { ...SAMPLE_METADATA, wpMediaId: 99 },
      },
      client: client as never,
    });

    const updateArg = client.__chains.articles!.update.mock.calls[0]![0] as {
      wp_featured_media_id: number | null;
    };
    expect(updateArg.wp_featured_media_id).toBe(99);
    // The attribution row also carries the cached wp_media_id.
    expect(client.__chains.article_image_uploads!.insert).toHaveBeenCalledWith(
      expect.objectContaining({ wp_media_id: 99 }),
    );
  });

  it("does NOT reuse wp_media_id when metadata.imageUrl doesn't match the new URL (stale pick)", async () => {
    const client = makeClient({ articles: { data: null, error: null } });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          status: "ready_for_review",
          featured_image_url: "https://example.com/old.jpg",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "a1" }, error: null });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: {
        ...baseFields,
        featuredImageUrl: "https://example.com/manually-pasted.jpg",
        selectedImageMetadata: { ...SAMPLE_METADATA, wpMediaId: 99 },
      },
      client: client as never,
    });

    const updateArg = client.__chains.articles!.update.mock.calls[0]![0] as {
      wp_featured_media_id: number | null;
    };
    expect(updateArg.wp_featured_media_id).toBeNull();
  });

  // --------------------------------------------------------------
  // sectionImages — diff/sync against article_image_uploads
  // --------------------------------------------------------------

  const SECTION_METADATA = {
    provider: "unsplash",
    providerPhotoId: "sec-1",
    imageUrl: "https://example.com/section.jpg",
    altText: "Section hero alt",
    photographerName: "Pat",
    photographerProfileUrl: "https://unsplash.com/@pat",
    photoUrl: "https://unsplash.com/photos/sec-1",
    downloadLocation: "https://api.unsplash.com/photos/sec-1/download",
    wpMediaId: null,
  };

  /**
   * Section-image tests share this `articles` chain setup: one
   * `maybeSingle` for the existence read + one `single` for the
   * update return. The saved `content_markdown` carries an H2 that
   * matches `intro` so the section parser's `validSectionKeys`
   * accepts that key downstream.
   */
  function makeSectionFlowClient(opts: { savedContentMarkdown: string }) {
    const client = makeClient({ articles: { data: null, error: null } });
    client.__chains.articles!.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: { status: "ready_for_review", featured_image_url: null },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    client.__chains.articles!.single = vi.fn().mockResolvedValueOnce({
      data: { id: "a1", content_markdown: opts.savedContentMarkdown },
      error: null,
    });
    return client;
  }

  /**
   * Overrides the `article_image_uploads` chain's awaitable
   * resolution to `{data: rows, error: null}`. Used by the section-
   * image sync tests so the list query (which awaits the chain
   * itself, not `.single()` or `.maybeSingle()`) yields the rows
   * the test wants to drive.
   */
  function setArticleImageUploadsListResult(
    client: ReturnType<typeof makeClient>,
    result: ChainResult<unknown>,
  ): void {
    const chain = client.__chains.article_image_uploads!;
    const thenImpl: PromiseLike<ChainResult<unknown>>["then"] = (
      onFulfilled,
      onRejected,
    ) => Promise.resolve(result).then(onFulfilled, onRejected);
    chain.then = thenImpl as typeof chain.then;
  }

  it("skips the section sync entirely when sectionImages is undefined", async () => {
    const client = makeSectionFlowClient({
      savedContentMarkdown: "## Intro\n\nbody",
    });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: { ...baseFields }, // no sectionImages
      client: client as never,
    });

    // No `from("article_image_uploads")` call should fire for the
    // sync path (the featured-image path only fires when metadata
    // is present, which it isn't in baseFields).
    const calls = client.from.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("article_image_uploads");
  });

  it("calls the section sync (inserts) when sectionImages is supplied for a saved H2", async () => {
    const client = makeSectionFlowClient({
      savedContentMarkdown: "## Intro\n\nbody",
    });
    // The sync's first await is the `listSectionImageRowsForArticle`
    // call → empty array. Subsequent insert hits `.single()` →
    // returns the new row id. Both share the same chain.
    client.__chains.article_image_uploads = makeChain({
      data: { id: "sec-row-1" },
      error: null,
    });
    setArticleImageUploadsListResult(client, { data: [], error: null });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: {
        ...baseFields,
        sectionImages: [
          {
            sectionKey: "intro",
            sectionHeading: "Intro",
            sortOrder: 0,
            imageUrl: SECTION_METADATA.imageUrl,
            altText: "Section hero alt",
            metadata: SECTION_METADATA,
          },
        ],
      },
      client: client as never,
    });

    expect(client.__chains.article_image_uploads!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        article_id: "a1",
        blog_id: "b1",
        role: "section",
        section_key: "intro",
        section_heading: "Intro",
        sort_order: 0,
        image_url: SECTION_METADATA.imageUrl,
      }),
    );
  });

  it("filters out stale section keys (heading removed from the saved body)", async () => {
    const client = makeSectionFlowClient({
      savedContentMarkdown: "## Intro\n\nbody", // only `intro`
    });
    client.__chains.article_image_uploads = makeChain({
      data: { id: "sec-row-1" },
      error: null,
    });
    setArticleImageUploadsListResult(client, { data: [], error: null });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: {
        ...baseFields,
        sectionImages: [
          // Intro IS in saved body → should insert.
          {
            sectionKey: "intro",
            sectionHeading: "Intro",
            sortOrder: 0,
            imageUrl: SECTION_METADATA.imageUrl,
            altText: "Intro",
            metadata: SECTION_METADATA,
          },
          // Ghost is NOT in saved body → should drop.
          {
            sectionKey: "ghost",
            sectionHeading: "Ghost",
            sortOrder: 1,
            imageUrl: "https://example.com/ghost.jpg",
            altText: "Ghost",
            metadata: {
              ...SECTION_METADATA,
              imageUrl: "https://example.com/ghost.jpg",
            },
          },
        ],
      },
      client: client as never,
    });

    const insertCalls =
      client.__chains.article_image_uploads!.insert.mock.calls;
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]![0]).toMatchObject({ section_key: "intro" });
  });

  it("empty sectionImages array against a body with H2s → no inserts (no-op sync)", async () => {
    const client = makeSectionFlowClient({
      savedContentMarkdown: "## Intro\n\nbody",
    });
    client.__chains.article_image_uploads = makeChain({
      data: null,
      error: null,
    });
    setArticleImageUploadsListResult(client, { data: [], error: null });

    await updateArticleFields({
      articleId: "a1",
      blogId: "b1",
      fields: { ...baseFields, sectionImages: [] },
      client: client as never,
    });

    expect(
      client.__chains.article_image_uploads!.insert,
    ).not.toHaveBeenCalled();
    expect(
      client.__chains.article_image_uploads!.update,
    ).not.toHaveBeenCalled();
  });
});

// ============================================================================
// getArticleIdsByIdeaIds
// ============================================================================

describe("getArticleIdsByIdeaIds", () => {
  it("returns an empty map for an empty input without hitting the DB", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
    });
    const result = await getArticleIdsByIdeaIds([], client as never);
    expect(result.size).toBe(0);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("maps idea id → most-recent article id", async () => {
    const rows = [
      // newest first per .order desc
      { id: "art-2", article_idea_id: "idea-A", created_at: "2026-05-08" },
      { id: "art-1", article_idea_id: "idea-A", created_at: "2026-05-07" },
      { id: "art-3", article_idea_id: "idea-B", created_at: "2026-05-08" },
    ];
    const client = makeClient({
      articles: { data: rows, error: null },
    });

    const result = await getArticleIdsByIdeaIds(
      ["idea-A", "idea-B"],
      client as never,
    );

    expect(result.size).toBe(2);
    expect(result.get("idea-A")).toBe("art-2");
    expect(result.get("idea-B")).toBe("art-3");
    expect(client.__chains.articles!.in).toHaveBeenCalledWith(
      "article_idea_id",
      ["idea-A", "idea-B"],
    );
    expect(client.__chains.articles!.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
  });

  it("ignores rows whose article_idea_id is null (defensive — shouldn't happen)", async () => {
    const rows = [
      { id: "art-1", article_idea_id: "idea-A", created_at: "2026-05-08" },
      { id: "art-orphan", article_idea_id: null, created_at: "2026-05-08" },
    ];
    const client = makeClient({
      articles: { data: rows, error: null },
    });

    const result = await getArticleIdsByIdeaIds(["idea-A"], client as never);
    expect(result.size).toBe(1);
    expect(result.get("idea-A")).toBe("art-1");
  });

  it("returns an empty map when supabase returns null data", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
    });

    const result = await getArticleIdsByIdeaIds(["idea-A"], client as never);
    expect(result.size).toBe(0);
  });

  it("propagates supabase errors", async () => {
    const client = makeClient({
      articles: { data: null, error: { message: "boom" } },
    });

    await expect(
      getArticleIdsByIdeaIds(["idea-A"], client as never),
    ).rejects.toEqual({ message: "boom" });
  });

  it("uses the admin client when none is injected", async () => {
    const client = makeClient({
      articles: { data: [], error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await getArticleIdsByIdeaIds(["idea-A"]);
    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});
