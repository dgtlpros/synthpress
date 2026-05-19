import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getActiveImageUploadForArticle,
  listRecentImageUploadsForBlog,
  listSectionImageRowsForArticle,
  recordArticleImageUpload,
  type ArticleImageUploadRow,
  type SectionImageDesiredState,
  type SelectedImageMetadata,
  stampWordPressMediaIdOnImageUpload,
  syncArticleSectionImageRows,
} from "./article-image-upload-service";

const mockedCreateAdmin = vi.mocked(createAdminClient);

interface ChainResult<T> {
  data: T;
  error: { message?: string } | null;
}

/**
 * Reusable mock chain: every chain call returns `this` so callers
 * can `.select().eq().eq().order().limit().maybeSingle()` etc., and
 * the terminal awaits (`maybeSingle`, `single`, `limit-then-await`)
 * resolve to the supplied result. Some queries terminate at
 * `.limit(N)` without `.maybeSingle()` — those are awaited via the
 * chain itself implementing `then`.
 */
function makeChain<T>(result: ChainResult<T>) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
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

const baseMetadata: SelectedImageMetadata = {
  provider: "unsplash",
  providerPhotoId: "abc",
  imageUrl: "https://images.unsplash.com/photo-abc?w=1080",
  altText: "Desk with laptop",
  photographerName: "Annie Spratt",
  photographerProfileUrl: "https://unsplash.com/@anniespratt",
  photoUrl: "https://unsplash.com/photos/abc",
  downloadLocation: "https://api.unsplash.com/photos/abc/download",
  wpMediaId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordArticleImageUpload", () => {
  it("inserts a row with all metadata mapped to snake_case columns", async () => {
    const inserted = { id: "row-1", article_id: "a1", blog_id: "b1" };
    const client = makeClient({
      article_image_uploads: { data: inserted, error: null },
    });

    const row = await recordArticleImageUpload({
      articleId: "a1",
      blogId: "b1",
      metadata: baseMetadata,
      client: client as never,
    });

    expect(row).toEqual(inserted);
    expect(client.__chains.article_image_uploads!.insert).toHaveBeenCalledWith({
      article_id: "a1",
      blog_id: "b1",
      provider: "unsplash",
      provider_photo_id: "abc",
      image_url: baseMetadata.imageUrl,
      alt_text: "Desk with laptop",
      photographer_name: "Annie Spratt",
      photographer_profile_url: "https://unsplash.com/@anniespratt",
      photo_url: "https://unsplash.com/photos/abc",
      download_location: baseMetadata.downloadLocation,
      wp_media_id: null,
      role: "featured",
      section_key: null,
      section_heading: null,
      sort_order: 0,
    });
  });

  it("respects a custom role when provided on the input", async () => {
    const client = makeClient({
      article_image_uploads: { data: { id: "row-2" }, error: null },
    });

    await recordArticleImageUpload({
      articleId: "a1",
      blogId: "b1",
      metadata: baseMetadata,
      role: "section",
      client: client as never,
    });

    expect(client.__chains.article_image_uploads!.insert).toHaveBeenCalledWith(
      expect.objectContaining({ role: "section" }),
    );
  });

  it("reads role from the metadata when input.role is omitted", async () => {
    const client = makeClient({
      article_image_uploads: { data: { id: "row-2b" }, error: null },
    });

    await recordArticleImageUpload({
      articleId: "a1",
      blogId: "b1",
      metadata: { ...baseMetadata, role: "section" },
      client: client as never,
    });

    expect(client.__chains.article_image_uploads!.insert).toHaveBeenCalledWith(
      expect.objectContaining({ role: "section" }),
    );
  });

  it("input.role wins over metadata.role when both are set", async () => {
    const client = makeClient({
      article_image_uploads: { data: { id: "row-2c" }, error: null },
    });

    await recordArticleImageUpload({
      articleId: "a1",
      blogId: "b1",
      metadata: { ...baseMetadata, role: "section" },
      role: "featured",
      client: client as never,
    });

    expect(client.__chains.article_image_uploads!.insert).toHaveBeenCalledWith(
      expect.objectContaining({ role: "featured" }),
    );
  });

  it("forwards section_key, section_heading, and sort_order from metadata", async () => {
    const client = makeClient({
      article_image_uploads: { data: { id: "row-2d" }, error: null },
    });

    await recordArticleImageUpload({
      articleId: "a1",
      blogId: "b1",
      metadata: {
        ...baseMetadata,
        role: "section",
        sectionKey: "how-to-set-up",
        sectionHeading: "How to set up",
        sortOrder: 3,
      },
      client: client as never,
    });

    expect(client.__chains.article_image_uploads!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "section",
        section_key: "how-to-set-up",
        section_heading: "How to set up",
        sort_order: 3,
      }),
    );
  });

  it("forwards a non-null wp_media_id when the metadata carries one", async () => {
    const client = makeClient({
      article_image_uploads: { data: { id: "row-3" }, error: null },
    });

    await recordArticleImageUpload({
      articleId: "a1",
      blogId: "b1",
      metadata: { ...baseMetadata, wpMediaId: 42 },
      client: client as never,
    });

    expect(client.__chains.article_image_uploads!.insert).toHaveBeenCalledWith(
      expect.objectContaining({ wp_media_id: 42 }),
    );
  });

  it("propagates supabase insert errors", async () => {
    const client = makeClient({
      article_image_uploads: {
        data: null,
        error: { message: "constraint violation" },
      },
    });
    await expect(
      recordArticleImageUpload({
        articleId: "a1",
        blogId: "b1",
        metadata: baseMetadata,
        client: client as never,
      }),
    ).rejects.toEqual({ message: "constraint violation" });
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makeClient({
      article_image_uploads: { data: { id: "row-4" }, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await recordArticleImageUpload({
      articleId: "a1",
      blogId: "b1",
      metadata: baseMetadata,
    });
    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});

describe("getActiveImageUploadForArticle", () => {
  it("returns null without querying when imageUrl is null", async () => {
    const client = makeClient({});
    const result = await getActiveImageUploadForArticle(
      "a1",
      null,
      client as never,
    );
    expect(result).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns null without querying when imageUrl is empty string", async () => {
    const client = makeClient({});
    const result = await getActiveImageUploadForArticle(
      "a1",
      "",
      client as never,
    );
    expect(result).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("queries by article_id + image_url + role='featured' and returns the latest row", async () => {
    const row = {
      id: "row-1",
      article_id: "a1",
      image_url: "https://example.com/x.jpg",
    };
    const client = makeClient({
      article_image_uploads: { data: row, error: null },
    });

    const result = await getActiveImageUploadForArticle(
      "a1",
      "https://example.com/x.jpg",
      client as never,
    );

    expect(result).toEqual(row);
    expect(client.__chains.article_image_uploads!.eq).toHaveBeenCalledWith(
      "article_id",
      "a1",
    );
    expect(client.__chains.article_image_uploads!.eq).toHaveBeenCalledWith(
      "image_url",
      "https://example.com/x.jpg",
    );
    expect(client.__chains.article_image_uploads!.eq).toHaveBeenCalledWith(
      "role",
      "featured",
    );
    expect(client.__chains.article_image_uploads!.order).toHaveBeenCalledWith(
      "created_at",
      { ascending: false },
    );
    expect(client.__chains.article_image_uploads!.limit).toHaveBeenCalledWith(
      1,
    );
  });

  it("filters by an explicit role when supplied", async () => {
    const client = makeClient({
      article_image_uploads: { data: null, error: null },
    });
    await getActiveImageUploadForArticle(
      "a1",
      "https://example.com/x.jpg",
      client as never,
      "section",
    );
    expect(client.__chains.article_image_uploads!.eq).toHaveBeenCalledWith(
      "role",
      "section",
    );
  });

  it("returns null when no matching row exists", async () => {
    const client = makeClient({
      article_image_uploads: { data: null, error: null },
    });
    const result = await getActiveImageUploadForArticle(
      "a1",
      "https://example.com/x.jpg",
      client as never,
    );
    expect(result).toBeNull();
  });

  it("propagates supabase errors", async () => {
    const client = makeClient({
      article_image_uploads: {
        data: null,
        error: { message: "boom" },
      },
    });
    await expect(
      getActiveImageUploadForArticle(
        "a1",
        "https://example.com/x.jpg",
        client as never,
      ),
    ).rejects.toEqual({ message: "boom" });
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makeClient({
      article_image_uploads: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    await getActiveImageUploadForArticle("a1", "https://example.com/x.jpg");
    expect(mockedCreateAdmin).toHaveBeenCalled();
  });
});

describe("listRecentImageUploadsForBlog", () => {
  it("returns the latest rows newest-first, deduped by image_url", async () => {
    // Two rows for the same `image_url` should collapse to one in
    // the output (the newest wins).
    const rows = [
      {
        id: "r1",
        blog_id: "b1",
        image_url: "https://x.com/a",
        created_at: "2026-05-01",
      },
      {
        id: "r2",
        blog_id: "b1",
        image_url: "https://x.com/b",
        created_at: "2026-04-30",
      },
      {
        id: "r3",
        blog_id: "b1",
        image_url: "https://x.com/a", // dup of r1, older
        created_at: "2026-03-01",
      },
    ];
    const client = makeClient({
      article_image_uploads: { data: rows, error: null },
    });

    const result = await listRecentImageUploadsForBlog("b1", {
      client: client as never,
    });

    expect(result.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(client.__chains.article_image_uploads!.eq).toHaveBeenCalledWith(
      "blog_id",
      "b1",
    );
  });

  it("respects a custom limit and pulls a wider window for dedupe", async () => {
    const client = makeClient({
      article_image_uploads: { data: [], error: null },
    });
    await listRecentImageUploadsForBlog("b1", {
      limit: 5,
      client: client as never,
    });
    // 5 * 4 = 20 fetched so a busy blog still surfaces 5 distinct rows.
    expect(client.__chains.article_image_uploads!.limit).toHaveBeenCalledWith(
      20,
    );
  });

  it("caps the output at the requested limit", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`,
      blog_id: "b1",
      image_url: `https://x.com/${i}`,
      created_at: `2026-05-${String(30 - i).padStart(2, "0")}`,
    }));
    const client = makeClient({
      article_image_uploads: { data: rows, error: null },
    });

    const result = await listRecentImageUploadsForBlog("b1", {
      limit: 4,
      client: client as never,
    });
    expect(result).toHaveLength(4);
  });

  it("returns [] when no rows match", async () => {
    const client = makeClient({
      article_image_uploads: { data: null, error: null },
    });
    const result = await listRecentImageUploadsForBlog("b1", {
      client: client as never,
    });
    expect(result).toEqual([]);
  });

  it("does NOT add a role filter when role option is omitted", async () => {
    const client = makeClient({
      article_image_uploads: { data: [], error: null },
    });
    await listRecentImageUploadsForBlog("b1", {
      client: client as never,
    });
    const eqCalls = client.__chains.article_image_uploads!.eq.mock.calls;
    expect(eqCalls).toEqual([["blog_id", "b1"]]);
  });

  it("adds a role filter when role option is supplied", async () => {
    const client = makeClient({
      article_image_uploads: { data: [], error: null },
    });
    await listRecentImageUploadsForBlog("b1", {
      role: "section",
      client: client as never,
    });
    expect(client.__chains.article_image_uploads!.eq).toHaveBeenCalledWith(
      "role",
      "section",
    );
  });

  it("propagates supabase errors", async () => {
    const client = makeClient({
      article_image_uploads: {
        data: null,
        error: { message: "boom" },
      },
    });
    await expect(
      listRecentImageUploadsForBlog("b1", { client: client as never }),
    ).rejects.toEqual({ message: "boom" });
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makeClient({
      article_image_uploads: { data: [], error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    await listRecentImageUploadsForBlog("b1");
    expect(mockedCreateAdmin).toHaveBeenCalled();
  });
});

describe("stampWordPressMediaIdOnImageUpload", () => {
  it("updates wp_media_id by row id", async () => {
    const client = makeClient({
      article_image_uploads: { data: null, error: null },
    });

    await stampWordPressMediaIdOnImageUpload({
      rowId: "row-1",
      wpMediaId: 42,
      client: client as never,
    });

    expect(client.__chains.article_image_uploads!.update).toHaveBeenCalledWith({
      wp_media_id: 42,
    });
    expect(client.__chains.article_image_uploads!.eq).toHaveBeenCalledWith(
      "id",
      "row-1",
    );
  });

  it("propagates supabase update errors", async () => {
    const client = makeClient({
      article_image_uploads: {
        data: null,
        error: { message: "denied" },
      },
    });
    await expect(
      stampWordPressMediaIdOnImageUpload({
        rowId: "row-1",
        wpMediaId: 42,
        client: client as never,
      }),
    ).rejects.toEqual({ message: "denied" });
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makeClient({
      article_image_uploads: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    await stampWordPressMediaIdOnImageUpload({
      rowId: "row-1",
      wpMediaId: 1,
    });
    expect(mockedCreateAdmin).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Section-image helpers
// ---------------------------------------------------------------------------

/**
 * Sequence-aware mock client.
 *
 * `syncArticleSectionImageRows` makes MANY sequential calls against
 * `article_image_uploads` in a single invocation (list → updates →
 * deletes → inserts). The single-shared-chain `makeClient` above
 * can't represent that — every await on the chain returns the same
 * canned result. This builder hands out a fresh chain on each
 * `from('article_image_uploads')` call, popped from a queue
 * supplied by the test. Anything beyond the queue's length falls
 * through to a noop chain so a test only has to specify the
 * results that matter.
 */
function makeSequenceClient(
  sequences: Record<string, Array<ChainResult<unknown>>>,
) {
  const queues: Record<string, Array<ChainResult<unknown>>> = {};
  const calls: Array<{ table: string; chain: ReturnType<typeof makeChain> }> =
    [];
  for (const [name, results] of Object.entries(sequences)) {
    queues[name] = [...results];
  }
  const client = {
    from: vi.fn((name: string) => {
      const next = queues[name]?.shift() ?? { data: null, error: null };
      const chain = makeChain(next);
      calls.push({ table: name, chain });
      return chain;
    }),
    __calls: calls,
  };
  return client as unknown as {
    from: ReturnType<typeof vi.fn>;
    __calls: Array<{ table: string; chain: ReturnType<typeof makeChain> }>;
  };
}

const SECTION_ROW_BASE: ArticleImageUploadRow = {
  id: "existing-row",
  article_id: "a1",
  blog_id: "b1",
  provider: "unsplash",
  provider_photo_id: "abc",
  image_url: "https://images.unsplash.com/photo-old?w=1080",
  alt_text: "old alt",
  photographer_name: "Annie",
  photographer_profile_url: "https://unsplash.com/@anniespratt",
  photo_url: "https://unsplash.com/photos/abc",
  download_location: "https://api.unsplash.com/photos/abc/download",
  wp_media_id: 42,
  role: "section",
  section_key: "intro",
  section_heading: "Intro",
  sort_order: 0,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
};

describe("listSectionImageRowsForArticle", () => {
  it("queries article_id + role='section', ordered by sort_order then created_at", async () => {
    const rows = [SECTION_ROW_BASE];
    const client = makeClient({
      article_image_uploads: { data: rows, error: null },
    });
    const result = await listSectionImageRowsForArticle("a1", client as never);
    expect(result).toEqual(rows);
    expect(client.__chains.article_image_uploads!.eq).toHaveBeenCalledWith(
      "article_id",
      "a1",
    );
    expect(client.__chains.article_image_uploads!.eq).toHaveBeenCalledWith(
      "role",
      "section",
    );
    expect(client.__chains.article_image_uploads!.order).toHaveBeenCalledWith(
      "sort_order",
      { ascending: true },
    );
    expect(client.__chains.article_image_uploads!.order).toHaveBeenCalledWith(
      "created_at",
      { ascending: true },
    );
  });

  it("returns [] when no rows match", async () => {
    const client = makeClient({
      article_image_uploads: { data: null, error: null },
    });
    expect(await listSectionImageRowsForArticle("a1", client as never)).toEqual(
      [],
    );
  });

  it("propagates supabase errors", async () => {
    const client = makeClient({
      article_image_uploads: { data: null, error: { message: "boom" } },
    });
    await expect(
      listSectionImageRowsForArticle("a1", client as never),
    ).rejects.toEqual({ message: "boom" });
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makeClient({
      article_image_uploads: { data: [], error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    await listSectionImageRowsForArticle("a1");
    expect(mockedCreateAdmin).toHaveBeenCalled();
  });
});

describe("syncArticleSectionImageRows", () => {
  const baseSectionMeta: SelectedImageMetadata = {
    ...baseMetadata,
    role: "section",
    sectionKey: "intro",
    sectionHeading: "Intro",
    sortOrder: 0,
  };

  it("no existing rows + no desired entries: noop (0/0/0)", async () => {
    const client = makeSequenceClient({
      article_image_uploads: [{ data: [], error: null }],
    });
    const result = await syncArticleSectionImageRows({
      articleId: "a1",
      blogId: "b1",
      desired: [],
      validSectionKeys: new Set(),
      client: client as never,
    });
    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 0 });
  });

  it("inserts a new row when desired contains a fresh pick", async () => {
    const client = makeSequenceClient({
      article_image_uploads: [
        { data: [], error: null }, // listSectionImageRowsForArticle
        { data: { id: "new-row" }, error: null }, // insert .select().single()
      ],
    });
    const desired: SectionImageDesiredState = {
      sectionKey: "intro",
      sectionHeading: "Intro",
      sortOrder: 0,
      imageUrl: baseSectionMeta.imageUrl,
      altText: "Hero alt",
      metadata: { ...baseSectionMeta, altText: "Hero alt" },
    };
    const result = await syncArticleSectionImageRows({
      articleId: "a1",
      blogId: "b1",
      desired: [desired],
      validSectionKeys: new Set(["intro"]),
      client: client as never,
    });
    expect(result).toEqual({ inserted: 1, updated: 0, deleted: 0 });

    const insertCall = client.__calls[1]!;
    expect(insertCall.chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "section",
        section_key: "intro",
        section_heading: "Intro",
        sort_order: 0,
        image_url: baseSectionMeta.imageUrl,
        alt_text: "Hero alt",
      }),
    );
  });

  it("UPDATEs lightweight metadata when the existing row's image_url matches", async () => {
    const client = makeSequenceClient({
      article_image_uploads: [
        { data: [SECTION_ROW_BASE], error: null }, // list
        { data: null, error: null }, // update
      ],
    });
    const desired: SectionImageDesiredState = {
      sectionKey: "intro",
      sectionHeading: "New Heading",
      sortOrder: 2,
      imageUrl: SECTION_ROW_BASE.image_url,
      altText: "Renamed alt",
      metadata: null, // alt-only edit
    };

    const result = await syncArticleSectionImageRows({
      articleId: "a1",
      blogId: "b1",
      desired: [desired],
      validSectionKeys: new Set(["intro"]),
      client: client as never,
    });

    expect(result).toEqual({ inserted: 0, updated: 1, deleted: 0 });
    const updateCall = client.__calls[1]!;
    expect(updateCall.chain.update).toHaveBeenCalledWith({
      alt_text: "Renamed alt",
      section_heading: "New Heading",
      sort_order: 2,
    });
    expect(updateCall.chain.eq).toHaveBeenCalledWith("id", "existing-row");
  });

  it("DELETEs old + INSERTs new when the image_url changes", async () => {
    const client = makeSequenceClient({
      article_image_uploads: [
        { data: [SECTION_ROW_BASE], error: null }, // list
        { data: null, error: null }, // delete old
        { data: { id: "new-row" }, error: null }, // insert new
      ],
    });
    const desired: SectionImageDesiredState = {
      sectionKey: "intro",
      sectionHeading: "Intro",
      sortOrder: 0,
      imageUrl: "https://images.unsplash.com/photo-NEW?w=1080",
      altText: "New alt",
      metadata: {
        ...baseSectionMeta,
        imageUrl: "https://images.unsplash.com/photo-NEW?w=1080",
        altText: "New alt",
      },
    };

    const result = await syncArticleSectionImageRows({
      articleId: "a1",
      blogId: "b1",
      desired: [desired],
      validSectionKeys: new Set(["intro"]),
      client: client as never,
    });

    expect(result).toEqual({ inserted: 1, updated: 0, deleted: 1 });
    const deleteCall = client.__calls[1]!;
    expect(deleteCall.chain.delete).toHaveBeenCalled();
    expect(deleteCall.chain.eq).toHaveBeenCalledWith("id", "existing-row");
    const insertCall = client.__calls[2]!;
    expect(insertCall.chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        section_key: "intro",
        image_url: "https://images.unsplash.com/photo-NEW?w=1080",
      }),
    );
  });

  it("DELETEs existing rows whose section_key is not in the desired list (user cleared the image)", async () => {
    const client = makeSequenceClient({
      article_image_uploads: [
        { data: [SECTION_ROW_BASE], error: null }, // list
        { data: null, error: null }, // delete orphan
      ],
    });
    const result = await syncArticleSectionImageRows({
      articleId: "a1",
      blogId: "b1",
      desired: [],
      validSectionKeys: new Set(["intro"]),
      client: client as never,
    });
    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 1 });
    const deleteCall = client.__calls[1]!;
    expect(deleteCall.chain.delete).toHaveBeenCalled();
    expect(deleteCall.chain.eq).toHaveBeenCalledWith("id", "existing-row");
  });

  it("DELETEs existing rows whose section_key disappeared from the saved body", async () => {
    // No desired entries, AND the existing row's key is not in
    // validSectionKeys — body edit removed the heading.
    const client = makeSequenceClient({
      article_image_uploads: [
        { data: [SECTION_ROW_BASE], error: null },
        { data: null, error: null }, // delete orphan
      ],
    });
    const result = await syncArticleSectionImageRows({
      articleId: "a1",
      blogId: "b1",
      desired: [],
      validSectionKeys: new Set(),
      client: client as never,
    });
    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 1 });
  });

  it("DROPs desired entries whose section_key is not in the saved body (stale pick)", async () => {
    const client = makeSequenceClient({
      article_image_uploads: [
        { data: [], error: null }, // list
      ],
    });
    const stale: SectionImageDesiredState = {
      sectionKey: "ghost-section",
      sectionHeading: "Ghost",
      sortOrder: 0,
      imageUrl: baseSectionMeta.imageUrl,
      altText: "Hero",
      metadata: baseSectionMeta,
    };
    const result = await syncArticleSectionImageRows({
      articleId: "a1",
      blogId: "b1",
      desired: [stale],
      validSectionKeys: new Set(["other-section"]),
      client: client as never,
    });
    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 0 });
    // Only the list call should have hit the DB.
    expect(client.__calls).toHaveLength(1);
  });

  it("synthesizes a minimal metadata when desired.metadata is null AND no existing row matches (manual paste path)", async () => {
    const client = makeSequenceClient({
      article_image_uploads: [
        { data: [], error: null }, // list (no existing row)
        { data: { id: "new-row" }, error: null }, // insert
      ],
    });
    const desired: SectionImageDesiredState = {
      sectionKey: "intro",
      sectionHeading: "Intro",
      sortOrder: 0,
      imageUrl: "https://cdn.example.com/manual.png",
      altText: "Manual paste",
      metadata: null,
    };
    await syncArticleSectionImageRows({
      articleId: "a1",
      blogId: "b1",
      desired: [desired],
      validSectionKeys: new Set(["intro"]),
      client: client as never,
    });
    const insertCall = client.__calls[1]!;
    expect(insertCall.chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "manual_url",
        section_key: "intro",
        image_url: "https://cdn.example.com/manual.png",
        alt_text: "Manual paste",
      }),
    );
  });

  it("handles multi-section updates in one call: insert one, update one, delete one", async () => {
    const intro = {
      ...SECTION_ROW_BASE,
      section_key: "intro",
      id: "row-intro",
    };
    const outro = {
      ...SECTION_ROW_BASE,
      section_key: "outro",
      id: "row-outro",
    };
    const client = makeSequenceClient({
      article_image_uploads: [
        { data: [intro, outro], error: null }, // list
        { data: null, error: null }, // update intro
        { data: { id: "row-faq" }, error: null }, // insert faq
        { data: null, error: null }, // delete outro orphan
      ],
    });
    const desired: SectionImageDesiredState[] = [
      {
        sectionKey: "intro",
        sectionHeading: "Intro",
        sortOrder: 0,
        imageUrl: intro.image_url,
        altText: "intro alt edit",
        metadata: null,
      },
      {
        sectionKey: "faq",
        sectionHeading: "FAQ",
        sortOrder: 1,
        imageUrl: "https://x.com/faq.jpg",
        altText: "faq alt",
        metadata: { ...baseSectionMeta, imageUrl: "https://x.com/faq.jpg" },
      },
    ];

    const result = await syncArticleSectionImageRows({
      articleId: "a1",
      blogId: "b1",
      desired,
      validSectionKeys: new Set(["intro", "faq"]),
      client: client as never,
    });
    expect(result).toEqual({ inserted: 1, updated: 1, deleted: 1 });
  });

  it("propagates supabase errors from the update phase", async () => {
    const client = makeSequenceClient({
      article_image_uploads: [
        { data: [SECTION_ROW_BASE], error: null }, // list
        { data: null, error: { message: "update failed" } }, // update
      ],
    });
    await expect(
      syncArticleSectionImageRows({
        articleId: "a1",
        blogId: "b1",
        desired: [
          {
            sectionKey: "intro",
            sectionHeading: "Intro",
            sortOrder: 0,
            imageUrl: SECTION_ROW_BASE.image_url,
            altText: "alt",
            metadata: null,
          },
        ],
        validSectionKeys: new Set(["intro"]),
        client: client as never,
      }),
    ).rejects.toEqual({ message: "update failed" });
  });

  it("propagates supabase errors from the delete phase (URL change → delete old)", async () => {
    const client = makeSequenceClient({
      article_image_uploads: [
        { data: [SECTION_ROW_BASE], error: null },
        { data: null, error: { message: "delete failed" } },
      ],
    });
    await expect(
      syncArticleSectionImageRows({
        articleId: "a1",
        blogId: "b1",
        desired: [
          {
            sectionKey: "intro",
            sectionHeading: "Intro",
            sortOrder: 0,
            imageUrl: "https://example.com/different.jpg",
            altText: "alt",
            metadata: {
              ...baseSectionMeta,
              imageUrl: "https://example.com/different.jpg",
            },
          },
        ],
        validSectionKeys: new Set(["intro"]),
        client: client as never,
      }),
    ).rejects.toEqual({ message: "delete failed" });
  });

  it("propagates supabase errors from the orphan-delete phase", async () => {
    const client = makeSequenceClient({
      article_image_uploads: [
        { data: [SECTION_ROW_BASE], error: null },
        { data: null, error: { message: "orphan delete failed" } },
      ],
    });
    await expect(
      syncArticleSectionImageRows({
        articleId: "a1",
        blogId: "b1",
        desired: [],
        validSectionKeys: new Set(),
        client: client as never,
      }),
    ).rejects.toEqual({ message: "orphan delete failed" });
  });

  it("falls back to the admin client when none is injected", async () => {
    const client = makeSequenceClient({
      article_image_uploads: [{ data: [], error: null }],
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    await syncArticleSectionImageRows({
      articleId: "a1",
      blogId: "b1",
      desired: [],
      validSectionKeys: new Set(),
    });
    expect(mockedCreateAdmin).toHaveBeenCalled();
  });
});
