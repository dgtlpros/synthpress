import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/services/team-policy-service", () => ({
  assertCan: vi.fn(),
  TeamPermissionError: class TeamPermissionError extends Error {
    code: string;
    action: string;
    role: string | null;
    constructor(code: string, action: string, role: string | null) {
      super(`Forbidden: cannot ${action}`);
      this.name = "TeamPermissionError";
      this.code = code;
      this.action = action;
      this.role = role;
    }
  },
}));

vi.mock("@/services/workspace-service", () => ({
  createTeamWithOwner: vi.fn(),
  generateUniqueTeamSlug: vi.fn(),
  generateUniqueProjectSlug: vi.fn(),
  generateUniqueBlogSlug: vi.fn(),
  listTeamsForUser: vi.fn(),
  listProjectsForTeam: vi.fn(),
  listBlogsForProject: vi.fn(),
  listPostsForBlog: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import {
  createTeamWithOwner,
  generateUniqueTeamSlug,
  generateUniqueProjectSlug,
  generateUniqueBlogSlug,
  listTeamsForUser,
  listPostsForBlog,
} from "@/services/workspace-service";
import {
  createTeam,
  createWorkspaceProject,
  createBlog,
  createPost,
  getTeamsForCurrentUser,
  getProjectsForTeam,
  getBlogsForProject,
  getPostsForBlog,
  updateProjectDescription,
  updateProjectSettings,
  updateTeam,
  deleteTeam,
  deleteProject,
  updateBlog,
  deleteBlog,
} from "./workspace";

const mockedRevalidatePath = vi.mocked(revalidatePath);
const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedAssertCan = vi.mocked(assertCan);
const mockedCreateTeamWithOwner = vi.mocked(createTeamWithOwner);
const mockedGenerateUniqueTeamSlug = vi.mocked(generateUniqueTeamSlug);
const mockedGenerateUniqueProjectSlug = vi.mocked(generateUniqueProjectSlug);
const mockedGenerateUniqueBlogSlug = vi.mocked(generateUniqueBlogSlug);
const mockedListTeamsForUser = vi.mocked(listTeamsForUser);

function mockAuth(user: { id: string } | null) {
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never);
}

function makeAdminChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  const proxy = new Proxy(chain, {
    get(_t, prop: string) {
      if (prop === "then") return undefined;
      if (prop in overrides) return overrides[prop];
      return () => proxy;
    },
  });
  return proxy;
}

function mockAdmin(tableHandlers: Record<string, unknown>) {
  mockedCreateAdminClient.mockReturnValue({
    from: (table: string) => tableHandlers[table] ?? makeAdminChain(),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createTeam", () => {
  it("returns error when name empty", async () => {
    mockAuth({ id: "u1" });
    const result = await createTeam("   ");
    expect(result).toEqual({ data: null, error: "Team name is required." });
    expect(mockedCreateTeamWithOwner).not.toHaveBeenCalled();
  });

  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await createTeam("Acme");
    expect(result).toEqual({ data: null, error: "You must be signed in." });
  });

  it("creates team and revalidates", async () => {
    mockAuth({ id: "u1" });
    mockedCreateTeamWithOwner.mockResolvedValue({
      id: "t1",
      name: "Acme",
      slug: "acme",
      created_by: "u1",
      billing_user_id: "u1",
      created_at: "",
      updated_at: "",
    });

    const result = await createTeam("Acme");

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "t1" });
    expect(mockedCreateTeamWithOwner).toHaveBeenCalledWith({
      name: "Acme",
      userId: "u1",
      client: expect.anything(),
    });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("returns error when createTeamWithOwner throws", async () => {
    mockAuth({ id: "u1" });
    mockedCreateTeamWithOwner.mockRejectedValue(new Error("service down"));
    const result = await createTeam("Acme");
    expect(result).toEqual({ data: null, error: "service down" });
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedCreateTeamWithOwner.mockRejectedValue("string thrown");
    const result = await createTeam("Acme");
    expect(result).toEqual({ data: null, error: "Could not create team." });
  });
});

describe("createWorkspaceProject", () => {
  it("returns error when name empty", async () => {
    mockAuth({ id: "u1" });
    const result = await createWorkspaceProject("tid", "  ");
    expect(result.error).toBe("Project name is required.");
  });

  it("inserts project when slug resolved", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueProjectSlug.mockResolvedValue("my-project");

    const single = vi
      .fn()
      .mockResolvedValue({ data: { id: "p1" }, error: null });
    const insert = vi
      .fn()
      .mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: vi.fn(() => ({ insert })),
    } as never);

    const result = await createWorkspaceProject("tid", "My Project");

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "p1" });
    expect(insert).toHaveBeenCalledWith({
      team_id: "tid",
      name: "My Project",
      slug: "my-project",
    });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams/tid/projects");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams/tid/projects/p1");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await createWorkspaceProject("tid", "My Project");
    expect(result.error).toMatch(/signed in/);
  });

  it("returns error when insert fails", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueProjectSlug.mockResolvedValue("my-project");
    const single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "dup" } });
    const insert = vi
      .fn()
      .mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: vi.fn(() => ({ insert })),
    } as never);
    const result = await createWorkspaceProject("tid", "X");
    expect(result.error).toBe("dup");
  });

  it("returns Error message when a regular Error is thrown in try", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueProjectSlug.mockRejectedValue(
      new Error("slug gen failed"),
    );
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
    } as never);
    const result = await createWorkspaceProject("tid", "X");
    expect(result.error).toBe("slug gen failed");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueProjectSlug.mockRejectedValue("random");
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
    } as never);
    const result = await createWorkspaceProject("tid", "X");
    expect(result.error).toBe("Could not create project.");
  });
});

describe("createBlog", () => {
  it("returns error when only some WP fields are provided", async () => {
    mockAuth({ id: "u1" });
    const result = await createBlog({
      teamId: "tid",
      projectId: "pid",
      name: "Blog",
      wpUrl: "",
      wpUsername: "u",
      wpAppPassword: "p",
    });
    expect(result.error).toMatch(/all required/);
  });

  it("inserts blog row with WP fields when all provided", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueBlogSlug.mockResolvedValue("main-blog");

    const single = vi
      .fn()
      .mockResolvedValue({ data: { id: "b1" }, error: null });
    const insert = vi
      .fn()
      .mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: vi.fn(() => ({ insert })),
    } as never);

    const result = await createBlog({
      teamId: "tid",
      projectId: "pid",
      name: "Main",
      wpUrl: "https://wp.example.com",
      wpUsername: "admin",
      wpAppPassword: "secret",
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "b1" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "pid",
        name: "Main",
        slug: "main-blog",
        wp_url: "https://wp.example.com",
        wp_username: "admin",
        wp_app_password: "secret",
      }),
    );
    expect(mockedRevalidatePath).toHaveBeenCalledWith(
      "/teams/tid/projects/pid/blogs",
    );
    expect(mockedRevalidatePath).toHaveBeenCalledWith(
      "/teams/tid/projects/pid/blogs/b1",
    );
    expect(mockedRevalidatePath).toHaveBeenCalledWith(
      "/teams/tid/projects/pid",
    );
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("inserts blog row with null WP fields when only name is provided", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueBlogSlug.mockResolvedValue("name-only");

    const single = vi
      .fn()
      .mockResolvedValue({ data: { id: "b2" }, error: null });
    const insert = vi
      .fn()
      .mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: vi.fn(() => ({ insert })),
    } as never);

    const result = await createBlog({
      teamId: "tid",
      projectId: "pid",
      name: "Name only",
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "b2" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "pid",
        name: "Name only",
        slug: "name-only",
        wp_url: null,
        wp_username: null,
        wp_app_password: null,
      }),
    );
  });

  it("returns Error message when a regular Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueBlogSlug.mockRejectedValue(new Error("slug boom"));
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
    } as never);
    const result = await createBlog({
      teamId: "tid",
      projectId: "pid",
      name: "Blog",
    });
    expect(result.error).toBe("slug boom");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueBlogSlug.mockRejectedValue("random");
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
    } as never);
    const result = await createBlog({
      teamId: "tid",
      projectId: "pid",
      name: "Blog",
    });
    expect(result.error).toBe("Could not create blog.");
  });
});

describe("updateProjectSettings", () => {
  it("returns error when name empty", async () => {
    mockAuth({ id: "u1" });
    const result = await updateProjectSettings("tid", "pid", {
      name: "   ",
      description: "x",
    });
    expect(result.error).toMatch(/name is required/i);
  });

  it("returns error when description exceeds max", async () => {
    mockAuth({ id: "u1" });
    const result = await updateProjectSettings("tid", "pid", {
      name: "Valid",
      description: "x".repeat(5001),
    });
    expect(result.error).toMatch(/at most/i);
  });

  it("returns error when project not found", async () => {
    mockAuth({ id: "u1" });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const select = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle }),
      }),
    });
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: vi.fn(() => ({ select })),
    } as never);

    const result = await updateProjectSettings("tid", "pid", {
      name: "N",
      description: "D",
    });
    expect(result.error).toMatch(/not found/i);
  });

  it("updates name description and slug when name changes", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueProjectSlug.mockResolvedValue("renamed-slug");

    const maybeSingle = vi.fn().mockResolvedValue({
      data: { name: "Old", slug: "old-slug" },
      error: null,
    });
    const select = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle }),
      }),
    });
    const eqTeamU = vi.fn().mockResolvedValue({ error: null });
    const eqIdU = vi.fn().mockReturnValue({ eq: eqTeamU });
    const update = vi.fn().mockReturnValue({ eq: eqIdU });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: vi.fn(() => ({ select, update })),
    } as never);

    const result = await updateProjectSettings("tid", "pid", {
      name: "Renamed",
      description: "  New desc  ",
    });

    expect(result.error).toBeNull();
    expect(update).toHaveBeenCalledWith({
      name: "Renamed",
      description: "New desc",
      slug: "renamed-slug",
    });
    expect(mockedRevalidatePath).toHaveBeenCalledWith(
      "/teams/tid/projects/pid",
    );
  });

  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await updateProjectSettings("tid", "pid", {
      name: "X",
      description: "Y",
    });
    expect(result.error).toMatch(/signed in/);
  });

  it("returns error when slug generation fails with Error", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueProjectSlug.mockRejectedValue(
      new Error("slug collision"),
    );

    const maybeSingle = vi.fn().mockResolvedValue({
      data: { name: "Old", slug: "old-slug" },
      error: null,
    });
    const select = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle }),
      }),
    });
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: vi.fn(() => ({ select })),
    } as never);

    const result = await updateProjectSettings("tid", "pid", {
      name: "New",
      description: "D",
    });
    expect(result.error).toBe("slug collision");
  });

  it("returns slug fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueProjectSlug.mockRejectedValue("random");
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { name: "Old", slug: "old-slug" },
      error: null,
    });
    const select = vi.fn().mockReturnValue({
      eq: vi
        .fn()
        .mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) }),
    });
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: vi.fn(() => ({ select })),
    } as never);
    const result = await updateProjectSettings("tid", "pid", {
      name: "New",
      description: "D",
    });
    expect(result.error).toBe("Could not update project slug.");
  });

  it("returns error when update query fails", async () => {
    mockAuth({ id: "u1" });

    const maybeSingle = vi.fn().mockResolvedValue({
      data: { name: "X", slug: "x" },
      error: null,
    });
    const select = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle }),
      }),
    });
    const eqTeamU = vi
      .fn()
      .mockResolvedValue({ error: { message: "update failed" } });
    const eqIdU = vi.fn().mockReturnValue({ eq: eqTeamU });
    const update = vi.fn().mockReturnValue({ eq: eqIdU });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: vi.fn(() => ({ select, update })),
    } as never);

    const result = await updateProjectSettings("tid", "pid", {
      name: "X",
      description: "Y",
    });
    expect(result.error).toBe("update failed");
  });
});

describe("updateProjectDescription", () => {
  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await updateProjectDescription("tid", "pid", "Hello");
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/signed in/);
  });

  it("returns error when description exceeds max length", async () => {
    mockAuth({ id: "u1" });
    const result = await updateProjectDescription(
      "tid",
      "pid",
      "x".repeat(5001),
    );
    expect(result.error).toMatch(/at most/);
  });

  it("updates description and revalidates", async () => {
    mockAuth({ id: "u1" });
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { name: "Project P" }, error: null })
      .mockResolvedValueOnce({
        data: { name: "Project P", slug: "project-p" },
        error: null,
      });
    const select = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle }),
      }),
    });
    const eqTeamU = vi.fn().mockResolvedValue({ error: null });
    const eqIdU = vi.fn().mockReturnValue({ eq: eqTeamU });
    const update = vi.fn().mockReturnValue({ eq: eqIdU });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: vi.fn(() => ({ select, update })),
    } as never);

    const result = await updateProjectDescription("tid", "pid", "  Roadmap  ");

    expect(result.error).toBeNull();
    expect(result.data).toBeNull();
    expect(update).toHaveBeenCalledWith({
      name: "Project P",
      description: "Roadmap",
      slug: "project-p",
    });
    expect(mockedRevalidatePath).toHaveBeenCalledWith(
      "/teams/tid/projects/pid",
    );
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams/tid/projects");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("returns error when project not found", async () => {
    mockAuth({ id: "u1" });
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      })),
    } as never);
    const result = await updateProjectDescription("tid", "pid", "Hello");
    expect(result.error).toBe("Project not found.");
  });
});

describe("createBlog — validation", () => {
  it("returns error when blog name is empty", async () => {
    const result = await createBlog({
      teamId: "tid",
      projectId: "pid",
      name: "  ",
    });
    expect(result.error).toBe("Blog name is required.");
  });

  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await createBlog({
      teamId: "tid",
      projectId: "pid",
      name: "Blog",
    });
    expect(result.error).toMatch(/signed in/);
  });

  it("returns error when insert fails", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueBlogSlug.mockResolvedValue("blog");
    const single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "dup slug" } });
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: vi.fn(() => ({
        insert: vi
          .fn()
          .mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
      })),
    } as never);
    const result = await createBlog({
      teamId: "tid",
      projectId: "pid",
      name: "Blog",
    });
    expect(result.error).toBe("dup slug");
  });
});

describe("getTeamsForCurrentUser", () => {
  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await getTeamsForCurrentUser();
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/signed in/);
  });

  it("returns teams from service", async () => {
    mockAuth({ id: "u1" });
    const rows = [
      {
        id: "t1",
        name: "T",
        slug: "t",
        created_by: null,
        billing_user_id: "u1",
        created_at: "",
        updated_at: "",
      },
    ];
    mockedListTeamsForUser.mockResolvedValue(rows as never);

    const result = await getTeamsForCurrentUser();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(rows);
    expect(mockedListTeamsForUser).toHaveBeenCalledWith(
      "u1",
      expect.anything(),
    );
  });

  it("returns Error message when service throws a regular Error", async () => {
    mockAuth({ id: "u1" });
    mockedListTeamsForUser.mockRejectedValue(new Error("connection error"));
    const result = await getTeamsForCurrentUser();
    expect(result.error).toBe("connection error");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedListTeamsForUser.mockRejectedValue("random");
    const result = await getTeamsForCurrentUser();
    expect(result.error).toBe("Could not load teams.");
  });
});

describe("getProjectsForTeam", () => {
  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await getProjectsForTeam("tid");
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/signed in/);
  });

  it("returns projects from service", async () => {
    mockAuth({ id: "u1" });
    const { listProjectsForTeam: mockedListProjects } =
      await import("@/services/workspace-service");
    vi.mocked(mockedListProjects).mockResolvedValue([
      {
        id: "p1",
        name: "P",
        slug: "p",
        team_id: "tid",
        description: null,
        created_at: "",
        updated_at: "",
      },
    ] as never);
    const result = await getProjectsForTeam("tid");
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
  });

  it("returns Error message when service throws a regular Error", async () => {
    mockAuth({ id: "u1" });
    const { listProjectsForTeam: mockedListProjects } =
      await import("@/services/workspace-service");
    vi.mocked(mockedListProjects).mockRejectedValue(new Error("pg timeout"));
    const result = await getProjectsForTeam("tid");
    expect(result.error).toBe("pg timeout");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    const { listProjectsForTeam: mockedListProjects } =
      await import("@/services/workspace-service");
    vi.mocked(mockedListProjects).mockRejectedValue("random");
    const result = await getProjectsForTeam("tid");
    expect(result.error).toBe("Could not load projects.");
  });
});

describe("getBlogsForProject", () => {
  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await getBlogsForProject("pid");
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/signed in/);
  });

  it("returns blogs from service", async () => {
    mockAuth({ id: "u1" });
    const { listBlogsForProject: mockedListBlogs } =
      await import("@/services/workspace-service");
    vi.mocked(mockedListBlogs).mockResolvedValue([] as never);
    const result = await getBlogsForProject("pid");
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it("returns Error message when service throws a regular Error", async () => {
    mockAuth({ id: "u1" });
    const { listBlogsForProject: mockedListBlogs } =
      await import("@/services/workspace-service");
    vi.mocked(mockedListBlogs).mockRejectedValue(new Error("table not found"));
    const result = await getBlogsForProject("pid");
    expect(result.error).toBe("table not found");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    const { listBlogsForProject: mockedListBlogs } =
      await import("@/services/workspace-service");
    vi.mocked(mockedListBlogs).mockRejectedValue("random");
    const result = await getBlogsForProject("pid");
    expect(result.error).toBe("Could not load blogs.");
  });
});

// ── updateTeam ────────────────────────────────────────────────────────────────

describe("updateTeam", () => {
  it("returns error when name is empty", async () => {
    const result = await updateTeam("t1", { name: "  " });
    expect(result.error).toBe("Team name is required.");
  });

  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await updateTeam("t1", { name: "Acme" });
    expect(result.error).toMatch(/signed in/);
  });

  it("returns forbidden when assertCan throws TeamPermissionError", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue(
      new TeamPermissionError("forbidden", "update_team", "member"),
    );
    mockAdmin({});
    const result = await updateTeam("t1", { name: "Acme" });
    expect(result.error).toBe("forbidden");
  });

  it("returns team not found when team row is missing", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("owner");
    mockAdmin({
      teams: {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      },
    });
    const result = await updateTeam("t1", { name: "New Name" });
    expect(result.error).toBe("Team not found.");
  });

  it("renames team, regenerates slug, and revalidates", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("owner");
    mockedGenerateUniqueTeamSlug.mockResolvedValue("new-name");

    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    mockAdmin({
      teams: {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { name: "Old Name", slug: "old-name" },
                error: null,
              }),
          }),
        }),
        update,
      },
    });

    const result = await updateTeam("t1", { name: "New Name" });

    expect(result.error).toBeNull();
    expect(update).toHaveBeenCalledWith({ name: "New Name", slug: "new-name" });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams/t1/settings");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams");
  });

  it("keeps slug when name is unchanged", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("owner");

    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    mockAdmin({
      teams: {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { name: "Acme", slug: "acme" },
                error: null,
              }),
          }),
        }),
        update,
      },
    });

    await updateTeam("t1", { name: "Acme" });

    expect(mockedGenerateUniqueTeamSlug).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ name: "Acme", slug: "acme" });
  });

  it("returns error when admin update query fails", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("owner");
    mockedGenerateUniqueTeamSlug.mockResolvedValue("new-name");

    const updateEq = vi
      .fn()
      .mockResolvedValue({ error: { message: "update failed" } });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    mockAdmin({
      teams: {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { name: "Old", slug: "old" },
                error: null,
              }),
          }),
        }),
        update,
      },
    });

    const result = await updateTeam("t1", { name: "New Name" });
    expect(result).toEqual({ data: null, error: "update failed" });
  });

  it("returns Error message when a regular Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue(new Error("db crashed"));
    mockAdmin({});
    const result = await updateTeam("t1", { name: "Acme" });
    expect(result.error).toBe("db crashed");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue("random");
    mockAdmin({});
    const result = await updateTeam("t1", { name: "Acme" });
    expect(result.error).toBe("Could not rename team.");
  });
});

// ── deleteTeam ────────────────────────────────────────────────────────────────

describe("deleteTeam", () => {
  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await deleteTeam("t1");
    expect(result.error).toMatch(/signed in/);
  });

  it("returns forbidden when assertCan throws", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue(
      new TeamPermissionError("forbidden", "delete_team", "admin"),
    );
    mockAdmin({});
    const result = await deleteTeam("t1");
    expect(result.error).toBe("forbidden");
  });

  it("returns Error message when a regular Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue(new Error("timeout"));
    mockAdmin({});
    const result = await deleteTeam("t1");
    expect(result.error).toBe("timeout");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue("random");
    mockAdmin({});
    const result = await deleteTeam("t1");
    expect(result.error).toBe("Could not delete team.");
  });

  it("returns error when final team delete query fails", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("owner");

    const teamDeleteEq = vi
      .fn()
      .mockResolvedValue({ error: { message: "FK violation" } });
    const teamDelete = vi.fn().mockReturnValue({ eq: teamDeleteEq });

    mockedCreateAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === "teams") return { delete: teamDelete };
        if (table === "projects")
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
            delete: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        return {
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
            in: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      },
    } as never);

    const result = await deleteTeam("t1");
    expect(result.error).toBe("FK violation");
  });

  it("returns error when project delete query fails in deleteProject", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("admin");

    const projectDeleteEq2 = vi
      .fn()
      .mockResolvedValue({ error: { message: "delete denied" } });
    const projectDeleteEq1 = vi.fn().mockReturnValue({ eq: projectDeleteEq2 });
    const projectsDelete = vi.fn().mockReturnValue({ eq: projectDeleteEq1 });
    const blogsDeleteEq = vi.fn().mockResolvedValue({ error: null });
    const blogsDelete = vi.fn().mockReturnValue({ eq: blogsDeleteEq });

    mockAdmin({
      blogs: { delete: blogsDelete },
      projects: { delete: projectsDelete },
    });

    const result = await deleteProject("t1", "p1");
    expect(result.error).toBe("delete denied");
  });

  it("deletes in FK-safe order and returns redirect", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("owner");

    const inviteDeleteEq = vi.fn().mockResolvedValue({ error: null });
    const inviteDelete = vi.fn().mockReturnValue({ eq: inviteDeleteEq });

    const memberDeleteEq = vi.fn().mockResolvedValue({ error: null });
    const memberDelete = vi.fn().mockReturnValue({ eq: memberDeleteEq });

    const projectSelectEq = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "p1" }, { id: "p2" }], error: null });
    const projectSelect = vi.fn().mockReturnValue({ eq: projectSelectEq });
    const blogsDeleteIn = vi.fn().mockResolvedValue({ error: null });
    const blogsDelete = vi.fn().mockReturnValue({ in: blogsDeleteIn });
    const projectsDeleteIn = vi.fn().mockResolvedValue({ error: null });
    const projectsDelete = vi.fn().mockReturnValue({ in: projectsDeleteIn });
    const teamDeleteEq = vi.fn().mockResolvedValue({ error: null });
    const teamDelete = vi.fn().mockReturnValue({ eq: teamDeleteEq });

    const adminFromMap: Record<string, unknown> = {
      team_invites: { delete: inviteDelete },
      team_members: { delete: memberDelete },
    };

    let projectDeleteCalled = false;
    mockedCreateAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === "projects" && !projectDeleteCalled) {
          return { select: projectSelect, delete: projectsDelete };
        }
        if (table === "blogs") return { delete: blogsDelete };
        if (table === "projects") {
          projectDeleteCalled = true;
          return { delete: projectsDelete };
        }
        if (table === "teams") return { delete: teamDelete };
        return adminFromMap[table] ?? {};
      },
    } as never);

    const result = await deleteTeam("t1");

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ redirect: "/teams" });
    expect(inviteDelete).toHaveBeenCalled();
    expect(memberDelete).toHaveBeenCalled();
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams");
  });
});

// ── deleteProject ─────────────────────────────────────────────────────────────

describe("deleteProject", () => {
  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await deleteProject("t1", "p1");
    expect(result.error).toMatch(/signed in/);
  });

  it("returns forbidden on permission error", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue(
      new TeamPermissionError("forbidden", "delete_project", "member"),
    );
    mockAdmin({});
    const result = await deleteProject("t1", "p1");
    expect(result.error).toBe("forbidden");
  });

  it("returns Error message when a regular Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue(new Error("db connection lost"));
    mockAdmin({});
    const result = await deleteProject("t1", "p1");
    expect(result.error).toBe("db connection lost");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue("random");
    mockAdmin({});
    const result = await deleteProject("t1", "p1");
    expect(result.error).toBe("Could not delete project.");
  });

  it("deletes blogs then project and returns redirect", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("admin");

    const blogsDeleteEq = vi.fn().mockResolvedValue({ error: null });
    const blogsDelete = vi.fn().mockReturnValue({ eq: blogsDeleteEq });
    const projectEq2 = vi.fn().mockResolvedValue({ error: null });
    const projectEq1 = vi.fn().mockReturnValue({ eq: projectEq2 });
    const projectsDelete = vi.fn().mockReturnValue({ eq: projectEq1 });

    mockAdmin({
      blogs: { delete: blogsDelete },
      projects: { delete: projectsDelete },
    });

    const result = await deleteProject("t1", "p1");

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ redirect: "/teams/t1/projects" });
    expect(blogsDelete).toHaveBeenCalled();
    expect(projectsDelete).toHaveBeenCalled();
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams/t1/projects");
  });
});

// ── updateBlog ────────────────────────────────────────────────────────────────

describe("updateBlog", () => {
  it("returns error when name is empty", async () => {
    const result = await updateBlog("t1", "p1", "b1", { name: "  " });
    expect(result.error).toBe("Blog name is required.");
  });

  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await updateBlog("t1", "p1", "b1", { name: "Blog" });
    expect(result.error).toMatch(/signed in/);
  });

  it("returns blog not found when row missing", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    } as never);
    const result = await updateBlog("t1", "p1", "b1", { name: "Blog" });
    expect(result.error).toBe("Blog not found.");
  });

  it("renames blog and revalidates", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockedGenerateUniqueBlogSlug.mockResolvedValue("new-blog");
    mockAdmin({});

    const updateEq2 = vi.fn().mockResolvedValue({ error: null });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { name: "Old Blog", slug: "old-blog" },
                  error: null,
                }),
            }),
          }),
        }),
        update,
      }),
    } as never);

    const result = await updateBlog("t1", "p1", "b1", { name: "New Blog" });

    expect(result.error).toBeNull();
    expect(update).toHaveBeenCalledWith({ name: "New Blog", slug: "new-blog" });
    expect(mockedRevalidatePath).toHaveBeenCalledWith(
      "/teams/t1/projects/p1/blogs/b1",
    );
  });

  it("returns error when update query fails", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});

    const updateEq2 = vi
      .fn()
      .mockResolvedValue({ error: { message: "update failed" } });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { name: "Blog", slug: "blog" },
                  error: null,
                }),
            }),
          }),
        }),
        update,
      }),
    } as never);

    const result = await updateBlog("t1", "p1", "b1", { name: "Blog" });
    expect(result).toEqual({ data: null, error: "update failed" });
  });
});

// ── deleteBlog ────────────────────────────────────────────────────────────────

describe("deleteBlog", () => {
  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await deleteBlog("t1", "p1", "b1");
    expect(result.error).toMatch(/signed in/);
  });

  it("returns forbidden on permission error", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue(
      new TeamPermissionError("forbidden", "manage_blog", "member"),
    );
    mockAdmin({});
    const result = await deleteBlog("t1", "p1", "b1");
    expect(result.error).toBe("forbidden");
  });

  it("deletes blog and returns redirect", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");

    const deleteEq2 = vi.fn().mockResolvedValue({ error: null });
    const deleteEq1 = vi.fn().mockReturnValue({ eq: deleteEq2 });
    const deleteBlogs = vi.fn().mockReturnValue({ eq: deleteEq1 });

    mockAdmin({ blogs: { delete: deleteBlogs } });

    const result = await deleteBlog("t1", "p1", "b1");

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ redirect: "/teams/t1/projects/p1/blogs" });
    expect(deleteBlogs).toHaveBeenCalled();
    expect(mockedRevalidatePath).toHaveBeenCalledWith(
      "/teams/t1/projects/p1/blogs",
    );
  });

  it("returns error when delete query fails", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");

    const deleteEq2 = vi
      .fn()
      .mockResolvedValue({ error: { message: "delete failed" } });
    const deleteEq1 = vi.fn().mockReturnValue({ eq: deleteEq2 });
    const deleteFn = vi.fn().mockReturnValue({ eq: deleteEq1 });

    mockAdmin({ blogs: { delete: deleteFn } });

    const result = await deleteBlog("t1", "p1", "b1");
    expect(result).toEqual({ data: null, error: "delete failed" });
  });

  it("returns Error message when a regular Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue(new Error("timeout"));
    mockAdmin({});
    const result = await deleteBlog("t1", "p1", "b1");
    expect(result.error).toBe("timeout");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue("random string");
    mockAdmin({});
    const result = await deleteBlog("t1", "p1", "b1");
    expect(result.error).toBe("Could not delete blog.");
  });
});

// ── updateBlog catch branches ────────────────────────────────────────────────

describe("updateBlog — catch branches", () => {
  it("returns TeamPermissionError code on permission failure", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue(
      new TeamPermissionError("forbidden", "manage_blog", "member"),
    );
    mockAdmin({});
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { name: "X", slug: "x" },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    } as never);
    const result = await updateBlog("t1", "p1", "b1", { name: "New" });
    expect(result.error).toBe("forbidden");
  });

  it("returns Error message when a regular Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue(new Error("connection refused"));
    mockAdmin({});
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { name: "X", slug: "x" },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    } as never);
    const result = await updateBlog("t1", "p1", "b1", { name: "New" });
    expect(result.error).toBe("connection refused");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue("random");
    mockAdmin({});
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { name: "X", slug: "x" },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    } as never);
    const result = await updateBlog("t1", "p1", "b1", { name: "New" });
    expect(result.error).toBe("Could not update blog.");
  });

  it("validates description length", async () => {
    const result = await updateBlog("t1", "p1", "b1", {
      description: "a".repeat(1001),
    });
    expect(result.error).toMatch(/Description must be at most/);
  });

  it("validates ai prompt template length", async () => {
    const result = await updateBlog("t1", "p1", "b1", {
      aiPromptTemplate: "a".repeat(8001),
    });
    expect(result.error).toMatch(/AI prompt template must be at most/);
  });

  it("validates settings.automation.generatePerWeek range", async () => {
    const result = await updateBlog("t1", "p1", "b1", {
      settings: { automation: { generatePerWeek: -1 } },
    });
    expect(result.error).toMatch(/Generate per week.*between 0 and 100/);
  });

  it("validates settings.automation.generatePerWeek upper bound", async () => {
    const result = await updateBlog("t1", "p1", "b1", {
      settings: { automation: { generatePerWeek: 1000 } },
    });
    expect(result.error).toMatch(/Generate per week.*between 0 and 100/);
  });

  it("rejects unknown timezone strings", async () => {
    const result = await updateBlog("t1", "p1", "b1", {
      settings: { automation: { timezone: "Atlantis/Lost" } },
    });
    expect(result.error).toMatch(/Unknown timezone/);
  });

  it("accepts a valid IANA timezone", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});
    const updateEq2 = vi.fn().mockResolvedValue({ error: null });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { name: "Blog", slug: "blog", settings: {} },
                  error: null,
                }),
            }),
          }),
        }),
        update,
      }),
    } as never);
    const result = await updateBlog("t1", "p1", "b1", {
      settings: { automation: { timezone: "America/New_York" } },
    });
    expect(result.error).toBeNull();
  });

  it("ignores blank timezone strings", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { name: "Blog", slug: "blog", settings: {} },
                  error: null,
                }),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }),
      }),
    } as never);
    const result = await updateBlog("t1", "p1", "b1", {
      settings: { automation: { timezone: "   " } },
    });
    expect(result.error).toBeNull();
  });

  it("validates backlogThreshold range", async () => {
    const result = await updateBlog("t1", "p1", "b1", {
      settings: { automation: { backlogThreshold: -5 } },
    });
    expect(result.error).toMatch(/Backlog threshold/);
  });

  it("validates backlogThreshold upper bound", async () => {
    const result = await updateBlog("t1", "p1", "b1", {
      settings: { automation: { backlogThreshold: 5000 } },
    });
    expect(result.error).toMatch(/Backlog threshold/);
  });

  it("rejects negative dailyTokenBudget", async () => {
    const result = await updateBlog("t1", "p1", "b1", {
      settings: { automation: { dailyTokenBudget: -1 } },
    });
    expect(result.error).toMatch(/Daily token budget/);
  });

  it("rejects non-numeric dailyTokenBudget (other than null)", async () => {
    const result = await updateBlog("t1", "p1", "b1", {
      settings: { automation: { dailyTokenBudget: Number.NaN } },
    });
    expect(result.error).toMatch(/Daily token budget/);
  });

  it("accepts null dailyTokenBudget (no per-blog cap)", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});
    const updateEq2 = vi.fn().mockResolvedValue({ error: null });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { name: "Blog", slug: "blog", settings: {} },
                  error: null,
                }),
            }),
          }),
        }),
        update,
      }),
    } as never);
    const result = await updateBlog("t1", "p1", "b1", {
      settings: { automation: { dailyTokenBudget: null } },
    });
    expect(result.error).toBeNull();
  });

  it("rejects partial WordPress connection", async () => {
    const result = await updateBlog("t1", "p1", "b1", {
      connection: {
        wpUrl: "https://x.com",
        wpUsername: "",
        wpAppPassword: "",
      },
    });
    expect(result.error).toMatch(/required when connecting/);
  });

  it("returns ok with no fields to update", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { name: "Blog", slug: "blog", settings: {} },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    } as never);
    const result = await updateBlog("t1", "p1", "b1", {});
    expect(result.error).toBeNull();
  });

  it("merges settings into existing jsonb", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});

    const updateEq2 = vi.fn().mockResolvedValue({ error: null });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    name: "Blog",
                    slug: "blog",
                    settings: { identity: { tone: "calm" } },
                  },
                  error: null,
                }),
            }),
          }),
        }),
        update,
      }),
    } as never);

    const result = await updateBlog("t1", "p1", "b1", {
      settings: { identity: { audience: "Devs" } },
    });

    expect(result.error).toBeNull();
    const settingsArg = update.mock.calls[0][0].settings;
    expect(settingsArg.identity.tone).toBe("calm");
    expect(settingsArg.identity.audience).toBe("Devs");
    expect(settingsArg.seo).toBeDefined();
  });

  it("clears WordPress connection when nulls passed", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});

    const updateEq2 = vi.fn().mockResolvedValue({ error: null });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { name: "B", slug: "b", settings: {} },
                  error: null,
                }),
            }),
          }),
        }),
        update,
      }),
    } as never);

    const result = await updateBlog("t1", "p1", "b1", {
      connection: { wpUrl: null, wpUsername: null, wpAppPassword: null },
    });
    expect(result.error).toBeNull();
    expect(update).toHaveBeenCalledWith({
      wp_url: null,
      wp_username: null,
      wp_app_password: null,
    });
  });

  it("normalizes keywords (trims, dedupes, caps)", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});

    const updateEq2 = vi.fn().mockResolvedValue({ error: null });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { name: "B", slug: "b", settings: {} },
                  error: null,
                }),
            }),
          }),
        }),
        update,
      }),
    } as never);

    const result = await updateBlog("t1", "p1", "b1", {
      keywords: [" SEO ", "seo", "ai", "", "AI", "growth"],
    });
    expect(result.error).toBeNull();
    expect(update).toHaveBeenCalledWith({
      keywords: ["SEO", "ai", "growth"],
    });
  });

  it("caps keywords at 50 and stops scanning the rest", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});

    const updateEq2 = vi.fn().mockResolvedValue({ error: null });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { name: "B", slug: "b", settings: {} },
                  error: null,
                }),
            }),
          }),
        }),
        update,
      }),
    } as never);

    // 60 unique keywords — only the first 50 should land.
    const inputKeywords = Array.from({ length: 60 }, (_, i) => `kw${i}`);
    const result = await updateBlog("t1", "p1", "b1", {
      keywords: inputKeywords,
    });
    expect(result.error).toBeNull();
    const arg = update.mock.calls[0][0];
    expect(arg.keywords).toHaveLength(50);
    expect(arg.keywords[0]).toBe("kw0");
    expect(arg.keywords[49]).toBe("kw49");
  });

  it("updates description / niche / aiPromptTemplate columns when provided", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});

    const updateEq2 = vi.fn().mockResolvedValue({ error: null });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { name: "B", slug: "b", settings: {} },
                  error: null,
                }),
            }),
          }),
        }),
        update,
      }),
    } as never);

    const result = await updateBlog("t1", "p1", "b1", {
      description: "  desc  ",
      niche: "  ai  ",
      aiPromptTemplate: "{{topic}}",
    });
    expect(result.error).toBeNull();
    expect(update).toHaveBeenCalledWith({
      description: "desc",
      niche: "ai",
      ai_prompt_template: "{{topic}}",
    });
  });

  it("rejects preserve-password when no stored password exists", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    name: "B",
                    slug: "b",
                    settings: {},
                    wp_app_password: null,
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    } as never);

    const result = await updateBlog("t1", "p1", "b1", {
      connection: {
        wpUrl: "https://x.com",
        wpUsername: "u",
        wpAppPassword: "",
      },
    });
    expect(result.error).toMatch(/Application password is required/);
  });

  it("preserves existing password when wpAppPassword is empty string", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});

    const updateEq2 = vi.fn().mockResolvedValue({ error: null });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    name: "B",
                    slug: "b",
                    settings: {},
                    wp_app_password: "existing-password",
                  },
                  error: null,
                }),
            }),
          }),
        }),
        update,
      }),
    } as never);

    const result = await updateBlog("t1", "p1", "b1", {
      connection: {
        wpUrl: "https://x.com",
        wpUsername: "u",
        wpAppPassword: "",
      },
    });
    expect(result.error).toBeNull();
    // wp_app_password should NOT be in the update object since we preserve.
    const arg = update.mock.calls[0][0];
    expect(arg).toMatchObject({ wp_url: "https://x.com", wp_username: "u" });
    expect(arg).not.toHaveProperty("wp_app_password");
  });
});

// ── getPostsForBlog ───────────────────────────────────────────────────────────

describe("getPostsForBlog", () => {
  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await getPostsForBlog("t1", "p1", "b1");
    expect(result.error).toMatch(/signed in/);
  });

  it("returns blog not found when row missing", async () => {
    mockAuth({ id: "u1" });
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    } as never);
    const result = await getPostsForBlog("t1", "p1", "b1");
    expect(result.error).toBe("Blog not found.");
  });

  it("delegates to listPostsForBlog and returns rows", async () => {
    mockAuth({ id: "u1" });
    const mockedList = vi.mocked(listPostsForBlog);
    mockedList.mockResolvedValue([{ id: "a1", title: "Hello" } as never]);

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: "b1" }, error: null }),
            }),
          }),
        }),
      }),
    } as never);

    const result = await getPostsForBlog("t1", "p1", "b1");
    expect(result.data?.length).toBe(1);
  });

  it("returns Error message when listPostsForBlog throws", async () => {
    mockAuth({ id: "u1" });
    const mockedList = vi.mocked(listPostsForBlog);
    mockedList.mockRejectedValue(new Error("db down"));

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: "b1" }, error: null }),
            }),
          }),
        }),
      }),
    } as never);

    const result = await getPostsForBlog("t1", "p1", "b1");
    expect(result.error).toBe("db down");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    const mockedList = vi.mocked(listPostsForBlog);
    mockedList.mockRejectedValue("oops");

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: "b1" }, error: null }),
            }),
          }),
        }),
      }),
    } as never);

    const result = await getPostsForBlog("t1", "p1", "b1");
    expect(result.error).toBe("Could not load posts.");
  });
});

// ── createPost ────────────────────────────────────────────────────────────────

describe("createPost", () => {
  it("returns error when title is empty", async () => {
    const result = await createPost("t1", "p1", "b1", { title: "  " });
    expect(result.error).toBe("Post title is required.");
  });

  it("returns error when title is too long", async () => {
    const result = await createPost("t1", "p1", "b1", {
      title: "x".repeat(201),
    });
    expect(result.error).toMatch(/at most 200/);
  });

  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await createPost("t1", "p1", "b1", { title: "Hello" });
    expect(result.error).toMatch(/signed in/);
  });

  it("returns forbidden on permission error", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue(
      new TeamPermissionError("forbidden", "manage_blog", "member"),
    );
    mockAdmin({});
    const result = await createPost("t1", "p1", "b1", { title: "Hello" });
    expect(result.error).toBe("forbidden");
  });

  it("returns blog not found when row missing", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    } as never);
    const result = await createPost("t1", "p1", "b1", { title: "Hello" });
    expect(result.error).toBe("Blog not found.");
  });

  it("inserts a draft post and returns its id", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});

    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: "post-1" },
      error: null,
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: (table: string) => {
        if (table === "blogs") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { id: "b1" }, error: null }),
                }),
              }),
            }),
          };
        }
        return { insert };
      },
    } as never);

    const result = await createPost("t1", "p1", "b1", {
      title: "New post",
      targetKeyword: "ai blogging",
      authorPersona: "Editorial",
    });

    expect(result.error).toBeNull();
    expect(result.data?.id).toBe("post-1");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        blog_id: "b1",
        title: "New post",
        target_keyword: "ai blogging",
        author_persona: "Editorial",
        status: "draft",
      }),
    );
  });

  it("returns insert error when supabase fails", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});

    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "insert failed" },
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: (table: string) => {
        if (table === "blogs") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { id: "b1" }, error: null }),
                }),
              }),
            }),
          };
        }
        return { insert };
      },
    } as never);

    const result = await createPost("t1", "p1", "b1", { title: "x" });
    expect(result.error).toBe("insert failed");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue("some-string");
    mockAdmin({});
    const result = await createPost("t1", "p1", "b1", { title: "Hello" });
    expect(result.error).toBe("Could not create post.");
  });

  it("returns thrown Error message verbatim", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockRejectedValue(new Error("network down"));
    mockAdmin({});
    const result = await createPost("t1", "p1", "b1", { title: "Hello" });
    expect(result.error).toBe("network down");
  });
});
