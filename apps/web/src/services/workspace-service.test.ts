import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  slugify,
  generateUniqueTeamSlug,
  generateUniqueProjectSlug,
  generateUniqueBlogSlug,
  listTeamsForUser,
  listProjectsForTeam,
  listBlogsForProject,
  getBlogById,
  listPostsForBlog,
  createTeamWithOwner,
} from "./workspace-service";

function mockMaybeSingleOnce(data: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Hello World", "fb")).toBe("hello-world");
  });

  it("strips unsafe characters", () => {
    expect(slugify("Foo!!! Bar***", "fb")).toBe("foo-bar");
  });

  it("uses fallback when result empty", () => {
    expect(slugify("!!!", "fallback")).toBe("fallback");
  });
});

describe("generateUniqueTeamSlug", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
  });

  it("returns base slug when unused", async () => {
    const client = mockMaybeSingleOnce(null);
    await expect(generateUniqueTeamSlug("My Team", client)).resolves.toBe(
      "my-team",
    );
  });

  it("suffixes when slug exists", async () => {
    let call = 0;
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockImplementation(() => {
              call += 1;
              return Promise.resolve({
                data: call === 1 ? { id: "existing" } : null,
                error: null,
              });
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(generateUniqueTeamSlug("My Team", client)).resolves.toMatch(
      /^my-team-aaaaaaaa$/,
    );
  });

  it("returns final fallback when all 8 attempts are exhausted", async () => {
    const client = mockMaybeSingleOnce({ id: "existing" });
    const result = await generateUniqueTeamSlug("My Team", client);
    expect(result).toMatch(/^my-team-aaaaaaaa$/);
  });
});

describe("generateUniqueProjectSlug", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
  });

  it("returns base slug when unused inside team", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: null, error: null }),
            }),
          })),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(
      generateUniqueProjectSlug("tid", "Alpha", client),
    ).resolves.toBe("alpha");
  });

  it("suffixes when slug collides inside team", async () => {
    let call = 0;
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockImplementation(() => {
                call += 1;
                return Promise.resolve({
                  data: call === 1 ? { id: "existing" } : null,
                  error: null,
                });
              }),
            }),
          })),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(
      generateUniqueProjectSlug("tid", "Alpha", client),
    ).resolves.toMatch(/^alpha-aaaaaaaa$/);
  });

  it("returns final fallback when all 8 attempts are exhausted", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: { id: "x" }, error: null }),
            }),
          })),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await generateUniqueProjectSlug("tid", "Alpha", client);
    expect(result).toMatch(/^alpha-aaaaaaaa$/);
  });
});

describe("generateUniqueBlogSlug", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
  });

  it("returns base slug when unused inside project", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: null, error: null }),
            }),
          })),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(
      generateUniqueBlogSlug("pid", "News blog", client),
    ).resolves.toBe("news-blog");
  });

  it("suffixes when slug collides inside project", async () => {
    let call = 0;
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockImplementation(() => {
                call += 1;
                return Promise.resolve({
                  data: call === 1 ? { id: "existing" } : null,
                  error: null,
                });
              }),
            }),
          })),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(
      generateUniqueBlogSlug("pid", "News", client),
    ).resolves.toMatch(/^news-aaaaaaaa$/);
  });

  it("returns final fallback when all 8 attempts are exhausted", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: { id: "x" }, error: null }),
            }),
          })),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await generateUniqueBlogSlug("pid", "News", client);
    expect(result).toMatch(/^news-aaaaaaaa$/);
  });
});

describe("listTeamsForUser", () => {
  it("returns empty array when user has no memberships", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await listTeamsForUser("u1", client);
    expect(result).toEqual([]);
  });

  it("returns team rows matching membership team_ids", async () => {
    const teamRows = [
      {
        id: "t1",
        name: "Team A",
        slug: "team-a",
        created_by: "u1",
        billing_user_id: "u1",
        created_at: "",
        updated_at: "",
      },
    ];

    const client = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "team_members") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ team_id: "t1" }],
                error: null,
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: teamRows, error: null }),
          }),
        };
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await listTeamsForUser("u1", client);
    expect(result).toEqual(teamRows);
  });

  it("throws on membership query error", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi
            .fn()
            .mockResolvedValue({ data: null, error: new Error("db error") }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(listTeamsForUser("u1", client)).rejects.toThrow("db error");
  });

  it("throws on teams query error", async () => {
    const client = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "team_members") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ team_id: "t1" }],
                error: null,
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: null,
              error: new Error("teams query failed"),
            }),
          }),
        };
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(listTeamsForUser("u1", client)).rejects.toThrow(
      "teams query failed",
    );
  });

  it("returns empty array when teams data is null (no error)", async () => {
    const client = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "team_members") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ team_id: "t1" }],
                error: null,
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        };
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await listTeamsForUser("u1", client);
    expect(result).toEqual([]);
  });

  it("handles null memberships data gracefully (memberships ?? [])", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await listTeamsForUser("u1", client);
    expect(result).toEqual([]);
  });
});

describe("listProjectsForTeam", () => {
  it("returns projects ordered by name", async () => {
    const projects = [
      {
        id: "p1",
        name: "Alpha",
        slug: "alpha",
        team_id: "t1",
        description: null,
        created_at: "",
        updated_at: "",
      },
    ];

    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: projects, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await listProjectsForTeam("t1", client);
    expect(result).toEqual(projects);
  });

  it("throws on query error", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi
              .fn()
              .mockResolvedValue({ data: null, error: new Error("fail") }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(listProjectsForTeam("t1", client)).rejects.toThrow("fail");
  });

  it("returns empty array when data is null (no error)", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await listProjectsForTeam("t1", client);
    expect(result).toEqual([]);
  });
});

describe("listBlogsForProject", () => {
  it("returns blog rows without wp_app_password", async () => {
    const blogs = [
      {
        id: "b1",
        name: "Blog",
        slug: "blog",
        project_id: "p1",
        wp_url: "https://x.co",
        wp_username: "admin",
        niche: "",
        keywords: [],
        ai_prompt_template: "",
        created_at: "",
        updated_at: "",
      },
    ];

    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: blogs, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await listBlogsForProject("p1", client);
    expect(result).toEqual(blogs);
    expect(result[0]).not.toHaveProperty("wp_app_password");
  });

  it("throws on query error", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: null,
              error: new Error("blog query failed"),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(listBlogsForProject("p1", client)).rejects.toThrow(
      "blog query failed",
    );
  });

  it("returns empty array when data is null (no error)", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await listBlogsForProject("p1", client);
    expect(result).toEqual([]);
  });
});

describe("getBlogById", () => {
  it("returns the blog row when found", async () => {
    const blog = { id: "b1", name: "Blog", slug: "blog" };
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: blog, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    const result = await getBlogById("p1", "b1", client);
    expect(result).toEqual(blog);
  });

  it("returns null when no row is found", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    const result = await getBlogById("p1", "b1", client);
    expect(result).toBeNull();
  });

  it("throws on supabase error", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: new Error("blog fetch failed"),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    await expect(getBlogById("p1", "b1", client)).rejects.toThrow(
      "blog fetch failed",
    );
  });
});

describe("listPostsForBlog", () => {
  it("returns post rows ordered by updated_at desc", async () => {
    const articles = [
      {
        id: "a1",
        blog_id: "b1",
        title: "First",
        status: "draft",
      },
    ];
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: articles, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    const result = await listPostsForBlog("b1", client);
    expect(result).toEqual(articles);
  });

  it("throws on query error", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: null,
              error: new Error("posts fail"),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    await expect(listPostsForBlog("b1", client)).rejects.toThrow("posts fail");
  });

  it("returns empty array when data is null", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    const result = await listPostsForBlog("b1", client);
    expect(result).toEqual([]);
  });
});

describe("createTeamWithOwner", () => {
  it("throws when team insert fails", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );

    const teamSingle = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("insert failed") });
    const teamSelect = vi.fn().mockReturnValue({ single: teamSingle });
    const teamInsert = vi.fn().mockReturnValue({ select: teamSelect });

    const client = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "teams") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: null, error: null }),
              }),
            }),
            insert: teamInsert,
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(
      createTeamWithOwner({ name: "Acme", userId: "u1", client }),
    ).rejects.toThrow("insert failed");
  });

  it("throws when team_members insert fails", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );

    const teamRow = {
      id: "t-new",
      name: "Acme",
      slug: "acme",
      created_by: "u1",
      billing_user_id: "u1",
      created_at: "",
      updated_at: "",
    };
    const memberInsert = vi
      .fn()
      .mockResolvedValue({ error: new Error("member insert failed") });
    const teamSingle = vi
      .fn()
      .mockResolvedValue({ data: teamRow, error: null });
    const teamSelect = vi.fn().mockReturnValue({ single: teamSingle });
    const teamInsert = vi.fn().mockReturnValue({ select: teamSelect });

    let insertCount = 0;
    const client = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "teams") {
          if (insertCount === 0) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: null, error: null }),
                }),
              }),
              insert: teamInsert,
            };
          }
          return { insert: teamInsert };
        }
        if (table === "team_members") {
          insertCount++;
          return { insert: memberInsert };
        }
        return {};
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(
      createTeamWithOwner({ name: "Acme", userId: "u1", client }),
    ).rejects.toThrow("member insert failed");
  });

  it("creates a team row and inserts the owner as a member", async () => {
    const teamRow = {
      id: "t-new",
      name: "Acme",
      slug: "acme",
      created_by: "u1",
      billing_user_id: "u1",
      created_at: "",
      updated_at: "",
    };

    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );

    const memberInsert = vi.fn().mockResolvedValue({ error: null });
    const teamSingle = vi
      .fn()
      .mockResolvedValue({ data: teamRow, error: null });
    const teamSelect = vi.fn().mockReturnValue({ single: teamSingle });
    const teamInsert = vi.fn().mockReturnValue({ select: teamSelect });

    let insertCount = 0;
    const client = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "teams") {
          if (insertCount === 0) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: null, error: null }),
                }),
              }),
              insert: teamInsert,
            };
          }
          return { insert: teamInsert };
        }
        if (table === "team_members") {
          insertCount++;
          return { insert: memberInsert };
        }
        return {};
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await createTeamWithOwner({
      name: "Acme",
      userId: "u1",
      client,
    });

    expect(result).toEqual(teamRow);
    expect(teamInsert).toHaveBeenCalled();
    expect(memberInsert).toHaveBeenCalledWith({
      team_id: "t-new",
      user_id: "u1",
      role: "owner",
    });
  });
});
