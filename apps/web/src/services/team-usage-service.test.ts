import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamUsage } from "./team-usage-service";

const mockedCreateAdmin = vi.mocked(createAdminClient);

interface MockChain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
}

function makeUsageQuery(rows: unknown[], error: unknown = null): MockChain {
  const limit = vi.fn().mockResolvedValue({ data: rows, error });
  const order = vi.fn().mockReturnValue({ limit });
  const eqMeta = vi.fn().mockReturnValue({ order });
  const eqType = vi.fn().mockReturnValue({ eq: eqMeta });
  const select = vi.fn().mockReturnValue({ eq: eqType });
  return { select, eq: eqType, in: vi.fn(), order, limit };
}

function makeInQuery(rows: unknown[]): MockChain {
  const inFn = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn().mockReturnValue({ in: inFn });
  return { select, eq: vi.fn(), in: inFn, order: vi.fn(), limit: vi.fn() };
}

function makeClient(opts: {
  txRows: unknown[];
  txError?: unknown;
  projects?: unknown[];
  blogs?: unknown[];
  profiles?: unknown[];
}) {
  const tx = makeUsageQuery(opts.txRows, opts.txError);
  const projects = makeInQuery(opts.projects ?? []);
  const blogs = makeInQuery(opts.blogs ?? []);
  const profiles = makeInQuery(opts.profiles ?? []);

  const client = {
    from: vi.fn((table: string) => {
      if (table === "token_transactions") return tx;
      if (table === "projects") return projects;
      if (table === "blogs") return blogs;
      if (table === "profiles") return profiles;
      throw new Error(`unexpected from(${table})`);
    }),
  };

  return { client, tx, projects, blogs, profiles };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTeamUsage", () => {
  it("returns empty result for no transactions", async () => {
    const { client } = makeClient({ txRows: [] });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await getTeamUsage({ teamId: "t1" });
    expect(result.rows).toEqual([]);
    expect(result.summary).toEqual({
      totalSpent: 0,
      totalTransactions: 0,
      byMember: [],
      byProject: [],
      byDay: [],
    });
  });

  it("propagates transaction query errors", async () => {
    const { client } = makeClient({ txRows: [], txError: { message: "boom" } });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(getTeamUsage({ teamId: "t1" })).rejects.toEqual({ message: "boom" });
  });

  it("joins names from projects, blogs, profiles", async () => {
    const txRows = [
      {
        id: "tx-1",
        amount: -10,
        description: "Run automation",
        created_at: "2026-05-01T10:00:00Z",
        type: "usage",
        metadata: {
          team_id: "t1",
          project_id: "p1",
          blog_id: "b1",
          acting_user_id: "u-actor",
        },
      },
      {
        id: "tx-2",
        amount: -5,
        description: null,
        created_at: "2026-05-02T11:00:00Z",
        type: "usage",
        metadata: {
          team_id: "t1",
          project_id: "p1",
          acting_user_id: "u-actor",
        },
      },
    ];
    const { client } = makeClient({
      txRows,
      projects: [{ id: "p1", name: "Marketing" }],
      blogs: [{ id: "b1", name: "Company Blog" }],
      profiles: [{ id: "u-actor", full_name: "Acting User" }],
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await getTeamUsage({ teamId: "t1" });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      project_name: "Marketing",
      blog_name: "Company Blog",
      acting_user_name: "Acting User",
    });
    expect(result.rows[1].project_name).toBe("Marketing");
    expect(result.rows[1].blog_name).toBeNull();

    expect(result.summary.totalSpent).toBe(15);
    expect(result.summary.byMember).toEqual([
      { actingUserId: "u-actor", actingUserName: "Acting User", spent: 15, count: 2 },
    ]);
    expect(result.summary.byProject).toEqual([
      { projectId: "p1", projectName: "Marketing", spent: 15, count: 2 },
    ]);
    expect(result.summary.byDay).toEqual([
      { day: "2026-05-02", spent: 5, count: 1 },
      { day: "2026-05-01", spent: 10, count: 1 },
    ]);
  });

  it("handles missing project/blog/user joins gracefully", async () => {
    const txRows = [
      {
        id: "tx-1",
        amount: -3,
        description: null,
        created_at: "2026-05-01T10:00:00Z",
        type: "usage",
        metadata: { team_id: "t1" },
      },
    ];
    const { client } = makeClient({ txRows });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await getTeamUsage({ teamId: "t1" });

    expect(result.rows[0]).toMatchObject({
      project_name: null,
      blog_name: null,
      acting_user_name: null,
      acting_user_id: null,
    });
    expect(result.summary.byMember).toEqual([
      { actingUserId: "__unknown__", actingUserName: null, spent: 3, count: 1 },
    ]);
    expect(result.summary.byProject).toEqual([
      { projectId: "__none__", projectName: null, spent: 3, count: 1 },
    ]);
  });

  it("does not query projects/blogs/profiles when no metadata ids present", async () => {
    const txRows = [
      {
        id: "tx-1",
        amount: -1,
        description: null,
        created_at: "2026-05-01T10:00:00Z",
        type: "usage",
        metadata: { team_id: "t1" },
      },
    ];
    const { client, projects, blogs, profiles } = makeClient({ txRows });
    mockedCreateAdmin.mockReturnValue(client as never);

    await getTeamUsage({ teamId: "t1" });
    expect(projects.in).not.toHaveBeenCalled();
    expect(blogs.in).not.toHaveBeenCalled();
    expect(profiles.in).not.toHaveBeenCalled();
  });

  it("uses absolute value of amount for spend totals (amount is negative)", async () => {
    const txRows = [
      {
        id: "tx-1",
        amount: -100,
        description: null,
        created_at: "2026-05-01T10:00:00Z",
        type: "usage",
        metadata: { team_id: "t1", acting_user_id: "u1" },
      },
    ];
    const { client } = makeClient({ txRows, profiles: [{ id: "u1", full_name: "X" }] });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await getTeamUsage({ teamId: "t1" });
    expect(result.summary.totalSpent).toBe(100);
  });

  it("respects custom limit", async () => {
    const { client, tx } = makeClient({ txRows: [] });
    mockedCreateAdmin.mockReturnValue(client as never);

    await getTeamUsage({ teamId: "t1", limit: 50 });
    expect(tx.limit).toHaveBeenCalledWith(50);
  });

  it("uses injected client", async () => {
    const { client } = makeClient({ txRows: [] });
    await getTeamUsage({ teamId: "t1", client: client as never });
    expect(mockedCreateAdmin).not.toHaveBeenCalled();
  });
});
