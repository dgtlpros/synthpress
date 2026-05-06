import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetTeamPlan = vi.fn();

vi.mock("@/services/team-billing-service", () => ({
  getTeamPlan: (...args: unknown[]) => mockGetTeamPlan(...args),
}));

import { listTeamsForUserWithMeta, teamListPlanLabel } from "./team-list-service";

describe("teamListPlanLabel", () => {
  it("returns Free for null plan key", () => {
    expect(teamListPlanLabel(null)).toBe("Free");
  });

  it("title-cases hyphenated plan keys", () => {
    expect(teamListPlanLabel("pro-plan")).toBe("Pro Plan");
  });
});

describe("listTeamsForUserWithMeta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTeamPlan.mockImplementation(async (teamId: string) => {
      if (teamId === "team-a") {
        return { ownerId: "u1", planKey: "pro", status: "active", balance: 100 };
      }
      if (teamId === "team-b") {
        return { ownerId: "u2", planKey: null, status: null, balance: 0 };
      }
      return null;
    });
  });

  it("returns empty groups when user has no memberships", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    };

    const admin = {} as never;

    const out = await listTeamsForUserWithMeta("u1", client as never, admin);
    expect(out).toEqual({ owned: [], joined: [] });
    expect(mockGetTeamPlan).not.toHaveBeenCalled();
  });

  it("splits owned vs joined, counts members and projects, resolves owner names", async () => {
    const client = {
      from(table: string) {
        if (table === "team_members") {
          return {
            select: (cols: string) => {
              if (cols.includes("role")) {
                return {
                  eq: () =>
                    Promise.resolve({
                      data: [
                        { team_id: "team-a", role: "owner" },
                        { team_id: "team-b", role: "member" },
                      ],
                      error: null,
                    }),
                };
              }
              return {
                in: () =>
                  Promise.resolve({
                    data: [
                      { team_id: "team-a" },
                      { team_id: "team-a" },
                      { team_id: "team-b" },
                    ],
                    error: null,
                  }),
              };
            },
          };
        }
        if (table === "teams") {
          return {
            select: () => ({
              in: () =>
                Promise.resolve({
                  data: [
                    {
                      id: "team-a",
                      name: "Alpha",
                      slug: "alpha",
                      created_at: "2026-01-01",
                      billing_user_id: "u1",
                    },
                    {
                      id: "team-b",
                      name: "Beta",
                      slug: "beta",
                      created_at: "2026-01-02",
                      billing_user_id: "u2",
                    },
                  ],
                  error: null,
                }),
            }),
          };
        }
        if (table === "projects") {
          return {
            select: () => ({
              in: () =>
                Promise.resolve({
                  data: [{ team_id: "team-a" }, { team_id: "team-a" }, { team_id: "team-b" }],
                  error: null,
                }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const admin = {
      from(table: string) {
        if (table === "profiles") {
          return {
            select: () => ({
              in: () =>
                Promise.resolve({
                  data: [
                    { id: "u1", full_name: "Owner One", avatar_url: null },
                    { id: "u2", full_name: null, avatar_url: null },
                  ],
                  error: null,
                }),
            }),
          };
        }
        throw new Error(`unexpected admin table ${table}`);
      },
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        },
      },
    };

    const out = await listTeamsForUserWithMeta("u1", client as never, admin as never);

    expect(out.owned).toHaveLength(1);
    expect(out.owned[0]).toMatchObject({
      id: "team-a",
      name: "Alpha",
      myRole: "owner",
      isOwner: true,
      ownerId: "u1",
      ownerName: "Owner One",
      ownerInitials: "OO",
      memberCount: 2,
      projectCount: 2,
      planKey: "pro",
      balance: 100,
    });

    expect(out.joined).toHaveLength(1);
    expect(out.joined[0]).toMatchObject({
      id: "team-b",
      name: "Beta",
      myRole: "member",
      isOwner: false,
      ownerId: "u2",
      ownerName: "the team owner",
      ownerInitials: "BE",
      memberCount: 1,
      projectCount: 1,
      planKey: null,
      balance: 0,
    });

    expect(mockGetTeamPlan).toHaveBeenCalledTimes(2);
    expect(admin.auth.admin.getUserById).not.toHaveBeenCalled();
  });

  it("uses auth admin email when viewer is owner and profile has no name", async () => {
    const client = {
      from(table: string) {
        if (table === "team_members") {
          return {
            select: (cols: string) => {
              if (cols.includes("role")) {
                return {
                  eq: () =>
                    Promise.resolve({
                      data: [{ team_id: "team-x", role: "owner" }],
                      error: null,
                    }),
                };
              }
              return {
                in: () =>
                  Promise.resolve({
                    data: [{ team_id: "team-x" }],
                    error: null,
                  }),
              };
            },
          };
        }
        if (table === "teams") {
          return {
            select: () => ({
              in: () =>
                Promise.resolve({
                  data: [
                    {
                      id: "team-x",
                      name: "Solo",
                      slug: "solo",
                      created_at: "2026-01-01",
                      billing_user_id: "u1",
                    },
                  ],
                  error: null,
                }),
            }),
          };
        }
        if (table === "projects") {
          return {
            select: () => ({
              in: () => Promise.resolve({ data: [], error: null }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const getUserById = vi.fn().mockResolvedValue({
      data: { user: { id: "u1", email: "me@example.com" } },
      error: null,
    });

    const admin = {
      from() {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [{ id: "u1", full_name: null, avatar_url: null }],
                error: null,
              }),
          }),
        };
      },
      auth: { admin: { getUserById } },
    };

    mockGetTeamPlan.mockResolvedValueOnce({
      ownerId: "u1",
      planKey: null,
      status: null,
      balance: 0,
    });

    const out = await listTeamsForUserWithMeta("u1", client as never, admin as never);

    expect(getUserById).toHaveBeenCalledWith("u1");
    expect(out.owned[0].ownerName).toBe("me@example.com");
    expect(out.owned[0].ownerInitials).toBe("M");
  });
});
