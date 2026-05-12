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

vi.mock("@/services/article-service", () => ({
  updateArticleFields: vi.fn(),
}));

vi.mock("@/services/wordpress-publish-service", () => {
  class PublishArticleError extends Error {
    code: string;
    details?: string;
    constructor(code: string, details?: string) {
      super(`publish_article_error:${code}`);
      this.code = code;
      this.details = details;
    }
  }
  return {
    publishArticleToWordPressDraft: vi.fn(),
    updateArticleWordPressDraft: vi.fn(),
    publishArticleToWordPressLive: vi.fn(),
    clearWordPressLink: vi.fn(),
    PublishArticleError,
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import { updateArticleFields } from "@/services/article-service";
import {
  clearWordPressLink,
  PublishArticleError,
  publishArticleToWordPressDraft,
  publishArticleToWordPressLive,
  updateArticleWordPressDraft,
} from "@/services/wordpress-publish-service";
import {
  clearArticleWordPressLink,
  publishArticleToWordPressLiveAction,
  sendArticleToWordPressDraft,
  updateArticle,
  updateArticleWordPressDraftAction,
} from "./articles";
import { PUBLISH_ARTICLE_ERROR_COPY } from "@/lib/wordpress-publish-error-copy";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdmin = vi.mocked(createAdminClient);
const mockedAssertCan = vi.mocked(assertCan);
const mockedUpdateArticleFields = vi.mocked(updateArticleFields);
const mockedRevalidatePath = vi.mocked(revalidatePath);
const mockedPublish = vi.mocked(publishArticleToWordPressDraft);
const mockedUpdateDraft = vi.mocked(updateArticleWordPressDraft);
const mockedPublishLive = vi.mocked(publishArticleToWordPressLive);
const mockedClear = vi.mocked(clearWordPressLink);

function makeAuthedClient(user: { id: string } | null = { id: "u1" }) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  };
}

interface BlogChain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
}

function makeAdminWithBlog(blog: { id: string } | null): {
  client: { from: ReturnType<typeof vi.fn> };
  chain: BlogChain;
} {
  const chain: BlogChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: blog, error: null }),
  };
  return { client: { from: vi.fn(() => chain) }, chain };
}

const baseFields = {
  title: "Edited",
  slug: "edited-article",
  excerpt: "An excerpt.",
  metaDescription: "A meta description.",
  targetKeyword: "edited",
  contentMarkdown: "Body.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(makeAuthedClient() as never);
  mockedCreateAdmin.mockReturnValue({} as never);
  mockedAssertCan.mockResolvedValue("owner" as never);
  mockedUpdateArticleFields.mockResolvedValue({
    id: "a1",
    blog_id: "b1",
    status: "ready_for_review",
  } as never);
});

describe("updateArticle", () => {
  it("rejects calls without an article id", async () => {
    const result = await updateArticle("t1", "p1", "b1", "", baseFields);
    expect(result.error).toBe("Article id is required.");
    expect(mockedUpdateArticleFields).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    mockedCreateClient.mockResolvedValue(makeAuthedClient(null) as never);

    const result = await updateArticle("t1", "p1", "b1", "a1", baseFields);
    expect(result.error).toBe("You must be signed in.");
    expect(mockedAssertCan).not.toHaveBeenCalled();
    expect(mockedUpdateArticleFields).not.toHaveBeenCalled();
  });

  it("checks manage_blog permission before doing any work", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    await updateArticle("t1", "p1", "b1", "a1", baseFields);

    expect(mockedAssertCan).toHaveBeenCalledWith(
      "t1",
      "u1",
      "manage_blog",
      expect.anything(),
    );
  });

  it("returns Blog not found when the blog isn't in this project", async () => {
    const { client } = makeAdminWithBlog(null);
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await updateArticle("t1", "p1", "b1", "a1", baseFields);
    expect(result.error).toBe("Blog not found.");
    expect(mockedUpdateArticleFields).not.toHaveBeenCalled();
  });

  it("delegates to updateArticleFields with the admin client", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    await updateArticle("t1", "p1", "b1", "a1", baseFields);

    expect(mockedUpdateArticleFields).toHaveBeenCalledWith({
      articleId: "a1",
      blogId: "b1",
      fields: baseFields,
      client: expect.anything(),
    });
  });

  it("returns the new status and revalidates the relevant paths", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await updateArticle("t1", "p1", "b1", "a1", baseFields);

    expect(result).toEqual({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const calls = mockedRevalidatePath.mock.calls.map((c) => c[0]);
    expect(calls).toContain("/teams/t1/projects/p1/blogs/b1/posts/a1");
    expect(calls).toContain("/teams/t1/projects/p1/blogs/b1");
  });

  it("translates article_not_found into a friendly error", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedUpdateArticleFields.mockRejectedValueOnce(
      new Error("article_not_found"),
    );

    const result = await updateArticle("t1", "p1", "b1", "a1", baseFields);
    expect(result.error).toBe("Article not found.");
  });

  it("translates slug_taken into a friendly error", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedUpdateArticleFields.mockRejectedValueOnce(new Error("slug_taken"));

    const result = await updateArticle("t1", "p1", "b1", "a1", baseFields);
    expect(result.error).toBe(
      "Slug is already used by another article in this blog.",
    );
  });

  it("translates each invalid_article_edit code into UI copy", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    const cases: Array<{ code: string; expected: RegExp }> = [
      { code: "title_required", expected: /title is required/i },
      { code: "title_too_long", expected: /title is too long/i },
      { code: "slug_too_long", expected: /slug is too long/i },
      { code: "slug_invalid", expected: /lowercase letters/i },
      { code: "excerpt_too_long", expected: /excerpt is too long/i },
      { code: "meta_description_too_long", expected: /meta description/i },
      {
        code: "target_keyword_too_long",
        expected: /target keyword is too long/i,
      },
      { code: "content_too_long", expected: /article body is too long/i },
    ];

    for (const { code, expected } of cases) {
      mockedUpdateArticleFields.mockRejectedValueOnce(
        new Error(`invalid_article_edit:${code}`),
      );
      const result = await updateArticle("t1", "p1", "b1", "a1", baseFields);
      expect(result.error).toMatch(expected);
    }
  });

  it("returns the TeamPermissionError code when the caller can't manage the blog", async () => {
    mockedAssertCan.mockRejectedValueOnce(
      new TeamPermissionError("forbidden", "manage_blog", "member" as never),
    );

    const result = await updateArticle("t1", "p1", "b1", "a1", baseFields);
    expect(result.error).toBe("forbidden");
  });

  it("propagates unknown service errors as-is", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedUpdateArticleFields.mockRejectedValueOnce(new Error("network"));

    const result = await updateArticle("t1", "p1", "b1", "a1", baseFields);
    expect(result.error).toBe("network");
  });

  it("falls back to the default error when something non-Error throws", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedUpdateArticleFields.mockRejectedValueOnce("nope");

    const result = await updateArticle("t1", "p1", "b1", "a1", baseFields);
    expect(result.error).toBe("Could not save article.");
  });
});

describe("sendArticleToWordPressDraft", () => {
  beforeEach(() => {
    mockedPublish.mockResolvedValue({
      wpPostId: 42,
      wpPostUrl: "https://example.com/?p=42",
      status: "draft",
    } as never);
  });

  it("rejects calls without an article id", async () => {
    const result = await sendArticleToWordPressDraft("t1", "p1", "b1", "");
    expect(result.error).toBe("Article id is required.");
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    mockedCreateClient.mockResolvedValue(makeAuthedClient(null) as never);

    const result = await sendArticleToWordPressDraft("t1", "p1", "b1", "a1");
    expect(result.error).toBe("You must be signed in.");
    expect(mockedAssertCan).not.toHaveBeenCalled();
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("checks manage_blog permission before doing any work", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    await sendArticleToWordPressDraft("t1", "p1", "b1", "a1");

    expect(mockedAssertCan).toHaveBeenCalledWith(
      "t1",
      "u1",
      "manage_blog",
      expect.anything(),
    );
  });

  it("returns Blog not found when the blog isn't in this project", async () => {
    const { client } = makeAdminWithBlog(null);
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await sendArticleToWordPressDraft("t1", "p1", "b1", "a1");
    expect(result.error).toBe("Blog not found.");
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("delegates to publishArticleToWordPressDraft with the admin client", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    await sendArticleToWordPressDraft("t1", "p1", "b1", "a1");

    expect(mockedPublish).toHaveBeenCalledWith({
      articleId: "a1",
      blogId: "b1",
      client: expect.anything(),
    });
  });

  it("returns the wp ids and revalidates the relevant paths on success", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await sendArticleToWordPressDraft("t1", "p1", "b1", "a1");

    expect(result).toEqual({
      data: {
        articleId: "a1",
        wpPostId: 42,
        wpPostUrl: "https://example.com/?p=42",
      },
      error: null,
    });
    const calls = mockedRevalidatePath.mock.calls.map((c) => c[0]);
    expect(calls).toContain("/teams/t1/projects/p1/blogs/b1/posts/a1");
    expect(calls).toContain("/teams/t1/projects/p1/blogs/b1");
  });

  it("translates each PublishArticleError code into the canonical UI copy", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    for (const code of Object.keys(PUBLISH_ARTICLE_ERROR_COPY)) {
      mockedPublish.mockRejectedValueOnce(
        new PublishArticleError(code as never),
      );
      const result = await sendArticleToWordPressDraft("t1", "p1", "b1", "a1");
      expect(result.error).toBe(
        PUBLISH_ARTICLE_ERROR_COPY[
          code as keyof typeof PUBLISH_ARTICLE_ERROR_COPY
        ],
      );
    }
  });

  it("returns the TeamPermissionError code when caller can't manage the blog", async () => {
    mockedAssertCan.mockRejectedValueOnce(
      new TeamPermissionError("forbidden", "manage_blog", "member" as never),
    );

    const result = await sendArticleToWordPressDraft("t1", "p1", "b1", "a1");
    expect(result.error).toBe("forbidden");
  });

  it("propagates unknown service errors as-is", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedPublish.mockRejectedValueOnce(new Error("network"));

    const result = await sendArticleToWordPressDraft("t1", "p1", "b1", "a1");
    expect(result.error).toBe("network");
  });

  it("falls back to the default error when something non-Error throws", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedPublish.mockRejectedValueOnce("nope");

    const result = await sendArticleToWordPressDraft("t1", "p1", "b1", "a1");
    expect(result.error).toBe("Could not send article to WordPress.");
  });
});

describe("PUBLISH_ARTICLE_ERROR_COPY", () => {
  it("includes UI copy for the v1.1 error codes", () => {
    expect(PUBLISH_ARTICLE_ERROR_COPY.wp_post_id_required).toMatch(
      /send it as a draft/i,
    );
    expect(PUBLISH_ARTICLE_ERROR_COPY.wp_post_not_found).toMatch(
      /could not be found/i,
    );
  });
});

describe("preflight (shared across all WP actions)", () => {
  it("surfaces non-TeamPermissionError throws from assertCan as a friendly Error message", async () => {
    mockedAssertCan.mockRejectedValueOnce(new Error("policy db unreachable"));

    const result = await sendArticleToWordPressDraft("t1", "p1", "b1", "a1");
    expect(result.error).toBe("policy db unreachable");
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("surfaces non-Error throws from assertCan as the generic fallback message", async () => {
    mockedAssertCan.mockRejectedValueOnce("nope");

    const result = await updateArticleWordPressDraftAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(result.error).toBe("WordPress action failed.");
  });
});

// ============================================================================
// updateArticleWordPressDraftAction
// ============================================================================

describe("updateArticleWordPressDraftAction", () => {
  beforeEach(() => {
    mockedUpdateDraft.mockResolvedValue({
      wpPostId: 7,
      wpPostUrl: "https://example.com/?p=7",
      wpStatus: "draft",
      publishedLocally: false,
    } as never);
  });

  it("rejects calls without an article id", async () => {
    const result = await updateArticleWordPressDraftAction(
      "t1",
      "p1",
      "b1",
      "",
    );
    expect(result.error).toBe("Article id is required.");
    expect(mockedUpdateDraft).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    mockedCreateClient.mockResolvedValue(makeAuthedClient(null) as never);
    const result = await updateArticleWordPressDraftAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(result.error).toBe("You must be signed in.");
    expect(mockedUpdateDraft).not.toHaveBeenCalled();
  });

  it("checks manage_blog permission before doing any work", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    await updateArticleWordPressDraftAction("t1", "p1", "b1", "a1");
    expect(mockedAssertCan).toHaveBeenCalledWith(
      "t1",
      "u1",
      "manage_blog",
      client,
    );
  });

  it("translates a TeamPermissionError into its code", async () => {
    mockedAssertCan.mockRejectedValueOnce(
      new TeamPermissionError("forbidden", "manage_blog", "member" as never),
    );

    const result = await updateArticleWordPressDraftAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(result.error).toBe("forbidden");
    expect(mockedUpdateDraft).not.toHaveBeenCalled();
  });

  it("returns Blog not found when the blog isn't in the project", async () => {
    const { client } = makeAdminWithBlog(null);
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await updateArticleWordPressDraftAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(result.error).toBe("Blog not found.");
    expect(mockedUpdateDraft).not.toHaveBeenCalled();
  });

  it("delegates to the service with the admin client and revalidates paths on success", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await updateArticleWordPressDraftAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(mockedUpdateDraft).toHaveBeenCalledWith({
      articleId: "a1",
      blogId: "b1",
      client,
    });
    expect(result.data).toEqual({
      articleId: "a1",
      wpPostId: 7,
      wpPostUrl: "https://example.com/?p=7",
      wpStatus: "draft",
      publishedLocally: false,
    });
    expect(mockedRevalidatePath).toHaveBeenCalledWith(
      "/teams/t1/projects/p1/blogs/b1/posts/a1",
    );
    expect(mockedRevalidatePath).toHaveBeenCalledWith(
      "/teams/t1/projects/p1/blogs/b1",
    );
  });

  it("translates a wp_post_not_found PublishArticleError into the friendly remote-missing copy", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedUpdateDraft.mockRejectedValueOnce(
      new PublishArticleError("wp_post_not_found", "404 Not Found"),
    );

    const result = await updateArticleWordPressDraftAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(result.error).toBe(PUBLISH_ARTICLE_ERROR_COPY.wp_post_not_found);
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });

  it("translates a wp_post_id_required error into the friendly never-sent copy", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedUpdateDraft.mockRejectedValueOnce(
      new PublishArticleError("wp_post_id_required"),
    );

    const result = await updateArticleWordPressDraftAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(result.error).toBe(PUBLISH_ARTICLE_ERROR_COPY.wp_post_id_required);
  });

  it("propagates unknown service errors as-is", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedUpdateDraft.mockRejectedValueOnce(new Error("network"));

    const result = await updateArticleWordPressDraftAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(result.error).toBe("network");
  });

  it("falls back to the default error when something non-Error throws", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedUpdateDraft.mockRejectedValueOnce("oops");

    const result = await updateArticleWordPressDraftAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(result.error).toBe("Could not update WordPress draft.");
  });
});

// ============================================================================
// publishArticleToWordPressLiveAction
// ============================================================================

describe("publishArticleToWordPressLiveAction", () => {
  beforeEach(() => {
    mockedPublishLive.mockResolvedValue({
      wpPostId: 7,
      wpPostUrl: "https://example.com/?p=7",
      wpStatus: "publish",
      publishedLocally: true,
    } as never);
  });

  it("rejects calls without an article id", async () => {
    const result = await publishArticleToWordPressLiveAction(
      "t1",
      "p1",
      "b1",
      "",
    );
    expect(result.error).toBe("Article id is required.");
    expect(mockedPublishLive).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    mockedCreateClient.mockResolvedValue(makeAuthedClient(null) as never);
    const result = await publishArticleToWordPressLiveAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(result.error).toBe("You must be signed in.");
  });

  it("checks manage_blog permission", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    await publishArticleToWordPressLiveAction("t1", "p1", "b1", "a1");
    expect(mockedAssertCan).toHaveBeenCalledWith(
      "t1",
      "u1",
      "manage_blog",
      client,
    );
  });

  it("delegates to publishArticleToWordPressLive on success and revalidates", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await publishArticleToWordPressLiveAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(mockedPublishLive).toHaveBeenCalledWith({
      articleId: "a1",
      blogId: "b1",
      client,
    });
    expect(result.data).toEqual({
      articleId: "a1",
      wpPostId: 7,
      wpPostUrl: "https://example.com/?p=7",
      wpStatus: "publish",
      publishedLocally: true,
    });
    expect(mockedRevalidatePath).toHaveBeenCalledTimes(2);
  });

  it("translates wp_post_not_found into the friendly remote-missing copy", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedPublishLive.mockRejectedValueOnce(
      new PublishArticleError("wp_post_not_found"),
    );

    const result = await publishArticleToWordPressLiveAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(result.error).toBe(PUBLISH_ARTICLE_ERROR_COPY.wp_post_not_found);
  });

  it("translates wp_request_failed into the friendly request-failed copy", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedPublishLive.mockRejectedValueOnce(
      new PublishArticleError("wp_request_failed", "500"),
    );

    const result = await publishArticleToWordPressLiveAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(result.error).toBe(PUBLISH_ARTICLE_ERROR_COPY.wp_request_failed);
  });

  it("falls back to the default error when something non-Error throws", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedPublishLive.mockRejectedValueOnce(undefined);

    const result = await publishArticleToWordPressLiveAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(result.error).toBe("Could not publish article live to WordPress.");
  });

  it("returns Blog not found when blog isn't in project", async () => {
    const { client } = makeAdminWithBlog(null);
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await publishArticleToWordPressLiveAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(result.error).toBe("Blog not found.");
    expect(mockedPublishLive).not.toHaveBeenCalled();
  });

  it("translates TeamPermissionError into its code", async () => {
    mockedAssertCan.mockRejectedValueOnce(
      new TeamPermissionError("not_a_member", "manage_blog", null),
    );

    const result = await publishArticleToWordPressLiveAction(
      "t1",
      "p1",
      "b1",
      "a1",
    );
    expect(result.error).toBe("not_a_member");
  });
});

// ============================================================================
// clearArticleWordPressLink
// ============================================================================

describe("clearArticleWordPressLink", () => {
  beforeEach(() => {
    mockedClear.mockResolvedValue(undefined as never);
  });

  it("rejects calls without an article id", async () => {
    const result = await clearArticleWordPressLink("t1", "p1", "b1", "");
    expect(result.error).toBe("Article id is required.");
    expect(mockedClear).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    mockedCreateClient.mockResolvedValue(makeAuthedClient(null) as never);
    const result = await clearArticleWordPressLink("t1", "p1", "b1", "a1");
    expect(result.error).toBe("You must be signed in.");
  });

  it("checks manage_blog permission and ownership before clearing", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    await clearArticleWordPressLink("t1", "p1", "b1", "a1");
    expect(mockedAssertCan).toHaveBeenCalledWith(
      "t1",
      "u1",
      "manage_blog",
      client,
    );
    expect(mockedClear).toHaveBeenCalledWith({
      articleId: "a1",
      blogId: "b1",
      client,
    });
  });

  it("translates TeamPermissionError into its code", async () => {
    mockedAssertCan.mockRejectedValueOnce(
      new TeamPermissionError("forbidden", "manage_blog", "viewer" as never),
    );

    const result = await clearArticleWordPressLink("t1", "p1", "b1", "a1");
    expect(result.error).toBe("forbidden");
    expect(mockedClear).not.toHaveBeenCalled();
  });

  it("returns Blog not found when blog isn't in project", async () => {
    const { client } = makeAdminWithBlog(null);
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await clearArticleWordPressLink("t1", "p1", "b1", "a1");
    expect(result.error).toBe("Blog not found.");
    expect(mockedClear).not.toHaveBeenCalled();
  });

  it("revalidates the article + posts paths on success", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await clearArticleWordPressLink("t1", "p1", "b1", "a1");
    expect(result.data).toEqual({ articleId: "a1" });
    expect(mockedRevalidatePath).toHaveBeenCalledWith(
      "/teams/t1/projects/p1/blogs/b1/posts/a1",
    );
    expect(mockedRevalidatePath).toHaveBeenCalledWith(
      "/teams/t1/projects/p1/blogs/b1",
    );
  });

  it("propagates service errors", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedClear.mockRejectedValueOnce(new Error("db down"));

    const result = await clearArticleWordPressLink("t1", "p1", "b1", "a1");
    expect(result.error).toBe("db down");
  });

  it("falls back to the default error when something non-Error throws", async () => {
    const { client } = makeAdminWithBlog({ id: "b1" });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedClear.mockRejectedValueOnce(undefined);

    const result = await clearArticleWordPressLink("t1", "p1", "b1", "a1");
    expect(result.error).toBe("Could not clear WordPress link.");
  });
});
