import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

vi.mock("@/services/team-invite-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/team-invite-service")
  >("@/services/team-invite-service");
  return {
    ...actual,
    createInvite: vi.fn(),
    acceptInvite: vi.fn(),
    revokeInvite: vi.fn(),
    listInvites: vi.fn(),
  };
});

vi.mock("@/services/team-policy-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/team-policy-service")
  >("@/services/team-policy-service");
  return { ...actual };
});

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  acceptInvite as acceptInviteService,
  createInvite as createInviteService,
  listInvites as listInvitesService,
  revokeInvite as revokeInviteService,
  TeamInviteError,
} from "@/services/team-invite-service";
import { TeamPermissionError } from "@/services/team-policy-service";
import {
  acceptInviteAction,
  createInviteAction,
  listInvitesAction,
  revokeInviteAction,
} from "./team-invites";

const mockedRevalidate = vi.mocked(revalidatePath);
const mockedCreate = vi.mocked(createClient);
const mockedAdmin = vi.mocked(createAdminClient);
const mockedCreateInvite = vi.mocked(createInviteService);
const mockedAcceptInvite = vi.mocked(acceptInviteService);
const mockedRevoke = vi.mocked(revokeInviteService);
const mockedList = vi.mocked(listInvitesService);

function mockUser(user: { id: string; email?: string | null } | null) {
  mockedCreate.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmin.mockReturnValue({} as never);
});

describe("createInviteAction", () => {
  it("rejects empty teamId", async () => {
    const result = await createInviteAction({ teamId: "", role: "member" });
    expect(result.error).toBe("teamId is required");
  });

  it("rejects invalid role", async () => {
    const result = await createInviteAction({
      teamId: "t1",
      role: "owner" as never,
    });
    expect(result.error).toBe("role must be admin or member");
  });

  it("rejects when not signed in", async () => {
    mockUser(null);
    const result = await createInviteAction({ teamId: "t1", role: "member" });
    expect(result.error).toBe("Not signed in");
  });

  it("creates invite and revalidates settings path", async () => {
    mockUser({ id: "u1" });
    mockedCreateInvite.mockResolvedValue({
      invite: {
        id: "i1",
        team_id: "t1",
        role: "member",
        email: null,
        invited_by: "u1",
        expires_at: "2099-01-01",
        accepted_at: null,
        accepted_by: null,
        revoked_at: null,
        created_at: "2026-01-01",
      },
      rawToken: "tok",
      acceptUrl: "https://x/teams/invite/tok",
    });

    const result = await createInviteAction({
      teamId: "t1",
      role: "member",
      email: "a@b.co",
    });

    expect(result.error).toBeNull();
    expect(result.rawToken).toBe("tok");
    expect(mockedCreateInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "t1",
        role: "member",
        email: "a@b.co",
        invitedBy: "u1",
      }),
    );
    expect(mockedRevalidate).toHaveBeenCalledWith("/teams/t1/settings");
  });

  it("returns permission error code", async () => {
    mockUser({ id: "u1" });
    mockedCreateInvite.mockRejectedValue(
      new TeamPermissionError("forbidden", "invite_member", "member"),
    );
    const result = await createInviteAction({ teamId: "t1", role: "member" });
    expect(result.error).toBe("forbidden");
  });

  it("returns generic error on service failure", async () => {
    mockUser({ id: "u1" });
    mockedCreateInvite.mockRejectedValue(new Error("boom"));
    const result = await createInviteAction({ teamId: "t1", role: "member" });
    expect(result.error).toBe("boom");
  });

  it("returns fallback error on non-Error rejection", async () => {
    mockUser({ id: "u1" });
    mockedCreateInvite.mockRejectedValue("oops");
    const result = await createInviteAction({ teamId: "t1", role: "member" });
    expect(result.error).toBe("Failed to create invite");
  });
});

describe("acceptInviteAction", () => {
  it("rejects empty token", async () => {
    const result = await acceptInviteAction("");
    expect(result.error).toBe("Missing invite token.");
  });

  it("rejects when not signed in", async () => {
    mockUser(null);
    const result = await acceptInviteAction("tok");
    expect(result.error).toBe("Not signed in");
  });

  it("rejects when user lacks email", async () => {
    mockUser({ id: "u1", email: null });
    const result = await acceptInviteAction("tok");
    expect(result.error).toBe("Not signed in");
  });

  it("accepts invite and revalidates", async () => {
    mockUser({ id: "u1", email: "a@b.co" });
    mockedAcceptInvite.mockResolvedValue({ teamId: "t1", role: "admin" });

    const result = await acceptInviteAction("tok");

    expect(result.error).toBeNull();
    expect(result.teamId).toBe("t1");
    expect(result.role).toBe("admin");
    expect(mockedRevalidate).toHaveBeenCalledWith("/teams/t1/projects");
    expect(mockedRevalidate).toHaveBeenCalledWith("/teams");
    expect(mockedRevalidate).toHaveBeenCalledWith("/dashboard");
  });

  it("returns invite error code", async () => {
    mockUser({ id: "u1", email: "a@b.co" });
    mockedAcceptInvite.mockRejectedValue(
      new TeamInviteError("expired", "expired"),
    );
    const result = await acceptInviteAction("tok");
    expect(result.error).toBe("expired");
  });

  it("returns generic error on unknown failure", async () => {
    mockUser({ id: "u1", email: "a@b.co" });
    mockedAcceptInvite.mockRejectedValue(new Error("db down"));
    const result = await acceptInviteAction("tok");
    expect(result.error).toBe("db down");
  });

  it("returns fallback error on non-Error rejection", async () => {
    mockUser({ id: "u1", email: "a@b.co" });
    mockedAcceptInvite.mockRejectedValue("oops");
    const result = await acceptInviteAction("tok");
    expect(result.error).toBe("Failed to accept invite");
  });
});

describe("revokeInviteAction", () => {
  function mockAdminWithLookup(teamId: string | null) {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: teamId ? { team_id: teamId } : null,
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const admin = { from: vi.fn().mockReturnValue({ select }) };
    mockedAdmin.mockReturnValue(admin as never);
  }

  it("rejects empty inviteId", async () => {
    const result = await revokeInviteAction("");
    expect(result.error).toBe("inviteId is required");
  });

  it("rejects when not signed in", async () => {
    mockUser(null);
    const result = await revokeInviteAction("i1");
    expect(result.error).toBe("Not signed in");
  });

  it("revokes invite and revalidates settings path", async () => {
    mockUser({ id: "u1" });
    mockAdminWithLookup("t1");
    mockedRevoke.mockResolvedValue();

    const result = await revokeInviteAction("i1");

    expect(result).toEqual({ ok: true, error: null });
    expect(mockedRevalidate).toHaveBeenCalledWith("/teams/t1/settings");
  });

  it("returns permission error code", async () => {
    mockUser({ id: "u1" });
    mockAdminWithLookup("t1");
    mockedRevoke.mockRejectedValue(
      new TeamPermissionError("forbidden", "revoke_invite", "member"),
    );
    const result = await revokeInviteAction("i1");
    expect(result.error).toBe("forbidden");
  });

  it("returns invite error code", async () => {
    mockUser({ id: "u1" });
    mockAdminWithLookup("t1");
    mockedRevoke.mockRejectedValue(new TeamInviteError("not_found", "x"));
    const result = await revokeInviteAction("i1");
    expect(result.error).toBe("not_found");
  });

  it("returns generic error on unknown failure", async () => {
    mockUser({ id: "u1" });
    mockAdminWithLookup("t1");
    mockedRevoke.mockRejectedValue(new Error("boom"));
    const result = await revokeInviteAction("i1");
    expect(result.error).toBe("boom");
  });

  it("does not revalidate when team_id lookup misses", async () => {
    mockUser({ id: "u1" });
    mockAdminWithLookup(null);
    mockedRevoke.mockResolvedValue();

    const result = await revokeInviteAction("i1");
    expect(result).toEqual({ ok: true, error: null });
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  it("returns fallback error on non-Error rejection", async () => {
    mockUser({ id: "u1" });
    mockAdminWithLookup("t1");
    mockedRevoke.mockRejectedValue("oops");
    const result = await revokeInviteAction("i1");
    expect(result.error).toBe("Failed to revoke invite");
  });
});

describe("listInvitesAction", () => {
  it("rejects empty teamId", async () => {
    const result = await listInvitesAction("");
    expect(result.error).toBe("teamId is required");
  });

  it("rejects when not signed in", async () => {
    mockUser(null);
    const result = await listInvitesAction("t1");
    expect(result.error).toBe("Not signed in");
  });

  it("returns invites on success", async () => {
    mockUser({ id: "u1" });
    const rows = [{ id: "i1" }] as never;
    mockedList.mockResolvedValue(rows);

    const result = await listInvitesAction("t1", { includeAccepted: true });
    expect(result.invites).toBe(rows);
    expect(mockedList).toHaveBeenCalledWith({
      teamId: "t1",
      actorUserId: "u1",
      includeAccepted: true,
      client: expect.anything(),
    });
  });

  it("returns permission error code", async () => {
    mockUser({ id: "u1" });
    mockedList.mockRejectedValue(
      new TeamPermissionError("forbidden", "list_invites", "member"),
    );
    const result = await listInvitesAction("t1");
    expect(result.error).toBe("forbidden");
  });

  it("returns generic error on unknown failure", async () => {
    mockUser({ id: "u1" });
    mockedList.mockRejectedValue(new Error("boom"));
    const result = await listInvitesAction("t1");
    expect(result.error).toBe("boom");
  });

  it("returns fallback error on non-Error rejection", async () => {
    mockUser({ id: "u1" });
    mockedList.mockRejectedValue("oops");
    const result = await listInvitesAction("t1");
    expect(result.error).toBe("Failed to load invites");
  });
});
