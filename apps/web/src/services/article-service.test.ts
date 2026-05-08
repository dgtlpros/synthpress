import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ARTICLE_CONTENT_MAX,
  ARTICLE_EXCERPT_MAX,
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
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  };
}

interface MockClient {
  from: ReturnType<typeof vi.fn>;
  __chains: Record<string, ReturnType<typeof makeChain>>;
}

function makeClient(
  table: Record<string, ChainResult<unknown>>,
): MockClient {
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
    expect(
      validateArticleEdit({ ...baseFields, slug: "Has Spaces" }),
    ).toBe("slug_invalid");
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
    expect(transitionArticleStatusOnEdit("scheduled")).toBe(
      "ready_for_review",
    );
    expect(transitionArticleStatusOnEdit("publishing")).toBe(
      "ready_for_review",
    );
    expect(transitionArticleStatusOnEdit("published")).toBe(
      "ready_for_review",
    );
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

    const result = await getArticleByIdForBlog(
      "a1",
      "b1",
      client as never,
    );

    expect(result).toEqual(row);
    expect(client.__chains.articles!.eq).toHaveBeenCalledWith("id", "a1");
    expect(client.__chains.articles!.eq).toHaveBeenCalledWith(
      "blog_id",
      "b1",
    );
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
    expect(client.__chains.articles!.order).toHaveBeenCalledWith(
      "created_at",
      { ascending: false },
    );
  });

  it("ignores rows whose article_idea_id is null (defensive — shouldn't happen)", async () => {
    const rows = [
      { id: "art-1", article_idea_id: "idea-A", created_at: "2026-05-08" },
      { id: "art-orphan", article_idea_id: null, created_at: "2026-05-08" },
    ];
    const client = makeClient({
      articles: { data: rows, error: null },
    });

    const result = await getArticleIdsByIdeaIds(
      ["idea-A"],
      client as never,
    );
    expect(result.size).toBe(1);
    expect(result.get("idea-A")).toBe("art-1");
  });

  it("returns an empty map when supabase returns null data", async () => {
    const client = makeClient({
      articles: { data: null, error: null },
    });

    const result = await getArticleIdsByIdeaIds(
      ["idea-A"],
      client as never,
    );
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
