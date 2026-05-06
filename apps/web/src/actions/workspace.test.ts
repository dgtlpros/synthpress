import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/services/workspace-service", () => ({
  createTeamWithOwner: vi.fn(),
  generateUniqueProjectSlug: vi.fn(),
  generateUniqueBlogSlug: vi.fn(),
  listTeamsForUser: vi.fn(),
  listProjectsForTeam: vi.fn(),
  listBlogsForProject: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createTeamWithOwner,
  generateUniqueProjectSlug,
  generateUniqueBlogSlug,
  listTeamsForUser,
} from "@/services/workspace-service";
import {
  createTeam,
  createWorkspaceProject,
  createBlog,
  getTeamsForCurrentUser,
  updateProjectDescription,
  updateProjectSettings,
} from "./workspace";

const mockedRevalidatePath = vi.mocked(revalidatePath);
const mockedCreateClient = vi.mocked(createClient);
const mockedCreateTeamWithOwner = vi.mocked(createTeamWithOwner);
const mockedGenerateUniqueProjectSlug = vi.mocked(generateUniqueProjectSlug);
const mockedGenerateUniqueBlogSlug = vi.mocked(generateUniqueBlogSlug);
const mockedListTeamsForUser = vi.mocked(listTeamsForUser);

function mockAuth(user: { id: string } | null) {
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
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
});

describe("updateProjectSettings", () => {
  it("returns error when name empty", async () => {
    mockAuth({ id: "u1" });
    const result = await updateProjectSettings("tid", "pid", { name: "   ", description: "x" });
    expect(result.error).toMatch(/name is required/i);
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
});
