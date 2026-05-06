import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertCan,
  getUserTeamRole,
  roleCan,
  TeamPermissionError,
  type TeamAction,
  type TeamRole,
} from "./team-policy-service";

const mockedCreateAdmin = vi.mocked(createAdminClient);

function makeClient(roleResult: { data: TeamRole | null; error: { message: string } | null }) {
  return {
    rpc: vi.fn().mockResolvedValue(roleResult),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserTeamRole", () => {
  it("calls user_team_role RPC and returns the role", async () => {
    const client = makeClient({ data: "owner", error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const role = await getUserTeamRole("t1", "u1");

    expect(role).toBe("owner");
    expect(client.rpc).toHaveBeenCalledWith("user_team_role", {
      p_team_id: "t1",
      p_user_id: "u1",
    });
  });

  it("returns null when user is not a member", async () => {
    const client = makeClient({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);
    await expect(getUserTeamRole("t1", "u1")).resolves.toBeNull();
  });

  it("uses injected client when provided", async () => {
    const client = makeClient({ data: "member", error: null });
    await getUserTeamRole("t1", "u1", client as never);
    expect(mockedCreateAdmin).not.toHaveBeenCalled();
  });

  it("throws on supabase error", async () => {
    const client = makeClient({ data: null, error: { message: "boom" } });
    mockedCreateAdmin.mockReturnValue(client as never);
    await expect(getUserTeamRole("t1", "u1")).rejects.toEqual({ message: "boom" });
  });
});

describe("assertCan", () => {
  function withRole(role: TeamRole | null) {
    const client = makeClient({ data: role, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);
    return client;
  }

  it("returns the role when permitted", async () => {
    withRole("owner");
    await expect(assertCan("t1", "u1", "delete_team")).resolves.toBe("owner");
  });

  it("throws not_a_member when user is not on the team", async () => {
    withRole(null);
    await expect(assertCan("t1", "u1", "invite_member")).rejects.toMatchObject({
      name: "TeamPermissionError",
      code: "not_a_member",
      action: "invite_member",
      role: null,
    });
  });

  it("throws forbidden when role lacks permission", async () => {
    withRole("member");
    await expect(assertCan("t1", "u1", "invite_member")).rejects.toMatchObject({
      name: "TeamPermissionError",
      code: "forbidden",
      action: "invite_member",
      role: "member",
    });
  });

  it("admin can invite_member but cannot delete_team", async () => {
    withRole("admin");
    await expect(assertCan("t1", "u1", "invite_member")).resolves.toBe("admin");
    withRole("admin");
    await expect(assertCan("t1", "u1", "delete_team")).rejects.toBeInstanceOf(TeamPermissionError);
  });

  it("member can consume_team_tokens but cannot remove_member", async () => {
    withRole("member");
    await expect(assertCan("t1", "u1", "consume_team_tokens")).resolves.toBe("member");
    withRole("member");
    await expect(assertCan("t1", "u1", "remove_member")).rejects.toBeInstanceOf(TeamPermissionError);
  });
});

describe("roleCan", () => {
  const cases: Array<[TeamRole, TeamAction, boolean]> = [
    ["owner", "delete_team", true],
    ["admin", "delete_team", false],
    ["member", "delete_team", false],
    ["owner", "invite_member", true],
    ["admin", "invite_member", true],
    ["member", "invite_member", false],
    ["member", "consume_team_tokens", true],
    ["member", "view_team_usage", true],
    ["admin", "view_team_usage", true],
    ["owner", "change_role", true],
    ["admin", "change_role", false],
  ];

  it.each(cases)("role %s × action %s → %s", (role, action, expected) => {
    expect(roleCan(role, action)).toBe(expected);
  });
});

describe("TeamPermissionError", () => {
  it("has descriptive message", () => {
    const err = new TeamPermissionError("forbidden", "delete_team", "member");
    expect(err.message).toMatch(/delete_team/);
    expect(err.message).toMatch(/member/);
    expect(err.code).toBe("forbidden");
    expect(err.action).toBe("delete_team");
    expect(err.role).toBe("member");
    expect(err.name).toBe("TeamPermissionError");
  });

  it("notes when caller is not a member", () => {
    const err = new TeamPermissionError("not_a_member", "invite_member", null);
    expect(err.message).toMatch(/not a member/);
  });
});
