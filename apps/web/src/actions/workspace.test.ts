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
} from "@/services/workspace-service";
import {
  createTeam,
  createWorkspaceProject,
  createBlog,
  getTeamsForCurrentUser,
  getProjectsForTeam,
  getBlogsForProject,
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

    const single = vi.fn().mockResolvedValue({ data: { id: "p1" }, error: null });
    const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });

    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
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
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "dup" } });
    const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: vi.fn(() => ({ insert })),
    } as never);
    const result = await createWorkspaceProject("tid", "X");
    expect(result.error).toBe("dup");
  });

  it("returns Error message when a regular Error is thrown in try", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueProjectSlug.mockRejectedValue(new Error("slug gen failed"));
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
    } as never);
    const result = await createWorkspaceProject("tid", "X");
    expect(result.error).toBe("slug gen failed");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueProjectSlug.mockRejectedValue("random");
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
    } as never);
    const result = await createWorkspaceProject("tid", "X");
    expect(result.error).toBe("Could not create project.");
  });
});

describe("createBlog", () => {
  it("returns error when WP fields missing", async () => {
    mockAuth({ id: "u1" });
    const result = await createBlog({
      teamId: "tid",
      projectId: "pid",
      name: "Blog",
      wpUrl: "",
      wpUsername: "u",
      wpAppPassword: "p",
    });
    expect(result.error).toMatch(/required/);
  });

  it("inserts blog row", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueBlogSlug.mockResolvedValue("main-blog");

    const single = vi.fn().mockResolvedValue({ data: { id: "b1" }, error: null });
    const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });

    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
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
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams/tid/projects/pid/blogs");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams/tid/projects/pid/blogs/b1");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams/tid/projects/pid");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("returns Error message when a regular Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueBlogSlug.mockRejectedValue(new Error("slug boom"));
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
    } as never);
    const result = await createBlog({
      teamId: "tid", projectId: "pid", name: "Blog",
      wpUrl: "https://wp.example.com", wpUsername: "admin", wpAppPassword: "secret",
    });
    expect(result.error).toBe("slug boom");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueBlogSlug.mockRejectedValue("random");
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
    } as never);
    const result = await createBlog({
      teamId: "tid", projectId: "pid", name: "Blog",
      wpUrl: "https://wp.example.com", wpUsername: "admin", wpAppPassword: "secret",
    });
    expect(result.error).toBe("Could not create blog.");
  });
});

describe("updateProjectSettings", () => {
  it("returns error when name empty", async () => {
    mockAuth({ id: "u1" });
    const result = await updateProjectSettings("tid", "pid", { name: "   ", description: "x" });
    expect(result.error).toMatch(/name is required/i);
  });

  it("returns error when description exceeds max", async () => {
    mockAuth({ id: "u1" });
    const result = await updateProjectSettings("tid", "pid", { name: "Valid", description: "x".repeat(5001) });
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
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: vi.fn(() => ({ select })),
    } as never);

    const result = await updateProjectSettings("tid", "pid", { name: "N", description: "D" });
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
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: vi.fn(() => ({ select, update })),
    } as never);

    const result = await updateProjectSettings("tid", "pid", { name: "Renamed", description: "  New desc  " });

    expect(result.error).toBeNull();
    expect(update).toHaveBeenCalledWith({
      name: "Renamed",
      description: "New desc",
      slug: "renamed-slug",
    });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams/tid/projects/pid");
  });

  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await updateProjectSettings("tid", "pid", { name: "X", description: "Y" });
    expect(result.error).toMatch(/signed in/);
  });

  it("returns error when slug generation fails with Error", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueProjectSlug.mockRejectedValue(new Error("slug collision"));

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
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: vi.fn(() => ({ select })),
    } as never);

    const result = await updateProjectSettings("tid", "pid", { name: "New", description: "D" });
    expect(result.error).toBe("slug collision");
  });

  it("returns slug fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueProjectSlug.mockRejectedValue("random");
    const maybeSingle = vi.fn().mockResolvedValue({ data: { name: "Old", slug: "old-slug" }, error: null });
    const select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) }) });
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: vi.fn(() => ({ select })),
    } as never);
    const result = await updateProjectSettings("tid", "pid", { name: "New", description: "D" });
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
    const eqTeamU = vi.fn().mockResolvedValue({ error: { message: "update failed" } });
    const eqIdU = vi.fn().mockReturnValue({ eq: eqTeamU });
    const update = vi.fn().mockReturnValue({ eq: eqIdU });

    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: vi.fn(() => ({ select, update })),
    } as never);

    const result = await updateProjectSettings("tid", "pid", { name: "X", description: "Y" });
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
    const result = await updateProjectDescription("tid", "pid", "x".repeat(5001));
    expect(result.error).toMatch(/at most/);
  });

  it("updates description and revalidates", async () => {
    mockAuth({ id: "u1" });
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { name: "Project P" }, error: null })
      .mockResolvedValueOnce({ data: { name: "Project P", slug: "project-p" }, error: null });
    const select = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle }),
      }),
    });
    const eqTeamU = vi.fn().mockResolvedValue({ error: null });
    const eqIdU = vi.fn().mockReturnValue({ eq: eqTeamU });
    const update = vi.fn().mockReturnValue({ eq: eqIdU });

    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
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
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams/tid/projects/pid");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams/tid/projects");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("returns error when project not found", async () => {
    mockAuth({ id: "u1" });
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
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
      teamId: "tid", projectId: "pid", name: "  ",
      wpUrl: "https://wp.co", wpUsername: "u", wpAppPassword: "p",
    });
    expect(result.error).toBe("Blog name is required.");
  });

  it("returns error when not signed in", async () => {
    mockAuth(null);
    const result = await createBlog({
      teamId: "tid", projectId: "pid", name: "Blog",
      wpUrl: "https://wp.co", wpUsername: "u", wpAppPassword: "p",
    });
    expect(result.error).toMatch(/signed in/);
  });

  it("returns error when insert fails", async () => {
    mockAuth({ id: "u1" });
    mockedGenerateUniqueBlogSlug.mockResolvedValue("blog");
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "dup slug" } });
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: vi.fn(() => ({
        insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
      })),
    } as never);
    const result = await createBlog({
      teamId: "tid", projectId: "pid", name: "Blog",
      wpUrl: "https://wp.co", wpUsername: "u", wpAppPassword: "p",
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
    expect(mockedListTeamsForUser).toHaveBeenCalledWith("u1", expect.anything());
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
    const { listProjectsForTeam: mockedListProjects } = await import("@/services/workspace-service");
    vi.mocked(mockedListProjects).mockResolvedValue([
      { id: "p1", name: "P", slug: "p", team_id: "tid", description: null, created_at: "", updated_at: "" },
    ] as never);
    const result = await getProjectsForTeam("tid");
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
  });

  it("returns Error message when service throws a regular Error", async () => {
    mockAuth({ id: "u1" });
    const { listProjectsForTeam: mockedListProjects } = await import("@/services/workspace-service");
    vi.mocked(mockedListProjects).mockRejectedValue(new Error("pg timeout"));
    const result = await getProjectsForTeam("tid");
    expect(result.error).toBe("pg timeout");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    const { listProjectsForTeam: mockedListProjects } = await import("@/services/workspace-service");
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
    const { listBlogsForProject: mockedListBlogs } = await import("@/services/workspace-service");
    vi.mocked(mockedListBlogs).mockResolvedValue([] as never);
    const result = await getBlogsForProject("pid");
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it("returns Error message when service throws a regular Error", async () => {
    mockAuth({ id: "u1" });
    const { listBlogsForProject: mockedListBlogs } = await import("@/services/workspace-service");
    vi.mocked(mockedListBlogs).mockRejectedValue(new Error("table not found"));
    const result = await getBlogsForProject("pid");
    expect(result.error).toBe("table not found");
  });

  it("returns generic fallback when a non-Error is thrown", async () => {
    mockAuth({ id: "u1" });
    const { listBlogsForProject: mockedListBlogs } = await import("@/services/workspace-service");
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
    mockedAssertCan.mockRejectedValue(new TeamPermissionError("forbidden", "update_team", "member"));
    mockAdmin({});
    const result = await updateTeam("t1", { name: "Acme" });
    expect(result.error).toBe("forbidden");
  });

  it("returns team not found when team row is missing", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("owner");
    mockAdmin({
      teams: {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
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
              Promise.resolve({ data: { name: "Old Name", slug: "old-name" }, error: null }),
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
              Promise.resolve({ data: { name: "Acme", slug: "acme" }, error: null }),
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

    const updateEq = vi.fn().mockResolvedValue({ error: { message: "update failed" } });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    mockAdmin({
      teams: {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { name: "Old", slug: "old" }, error: null }),
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
    mockedAssertCan.mockRejectedValue(new TeamPermissionError("forbidden", "delete_team", "admin"));
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

    const teamDeleteEq = vi.fn().mockResolvedValue({ error: { message: "FK violation" } });
    const teamDelete = vi.fn().mockReturnValue({ eq: teamDeleteEq });

    mockedCreateAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === "teams") return { delete: teamDelete };
        if (table === "projects") return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }), delete: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ error: null }) }) };
        return { delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }), in: vi.fn().mockResolvedValue({ error: null }) }) };
      },
    } as never);

    const result = await deleteTeam("t1");
    expect(result.error).toBe("FK violation");
  });

  it("returns error when project delete query fails in deleteProject", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("admin");

    const projectDeleteEq2 = vi.fn().mockResolvedValue({ error: { message: "delete denied" } });
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

    const projectSelectEq = vi.fn().mockResolvedValue({ data: [{ id: "p1" }, { id: "p2" }], error: null });
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
        if (table === "projects") { projectDeleteCalled = true; return { delete: projectsDelete }; }
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
    mockedAssertCan.mockRejectedValue(new TeamPermissionError("forbidden", "delete_project", "member"));
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
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
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
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { name: "Old Blog", slug: "old-blog" }, error: null }),
            }),
          }),
        }),
        update,
      }),
    } as never);

    const result = await updateBlog("t1", "p1", "b1", { name: "New Blog" });

    expect(result.error).toBeNull();
    expect(update).toHaveBeenCalledWith({ name: "New Blog", slug: "new-blog" });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams/t1/projects/p1/blogs/b1");
  });

  it("returns error when update query fails", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockAdmin({});

    const updateEq2 = vi.fn().mockResolvedValue({ error: { message: "update failed" } });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });

    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { name: "Blog", slug: "blog" }, error: null }),
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
    mockedAssertCan.mockRejectedValue(new TeamPermissionError("forbidden", "manage_blog", "member"));
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
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/teams/t1/projects/p1/blogs");
  });

  it("returns error when delete query fails", async () => {
    mockAuth({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");

    const deleteEq2 = vi.fn().mockResolvedValue({ error: { message: "delete failed" } });
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
    mockedAssertCan.mockRejectedValue(new TeamPermissionError("forbidden", "manage_blog", "member"));
    mockAdmin({});
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: "X", slug: "x" }, error: null }) }),
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
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: "X", slug: "x" }, error: null }) }),
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
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: "X", slug: "x" }, error: null }) }),
          }),
        }),
      }),
    } as never);
    const result = await updateBlog("t1", "p1", "b1", { name: "New" });
    expect(result.error).toBe("Could not rename blog.");
  });
});
