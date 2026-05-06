import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));
vi.mock("@/actions/team-invites", () => ({
  createInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
}));
vi.mock("@/actions/team-members", () => ({
  removeMember: vi.fn(),
  changeMemberRole: vi.fn(),
}));
vi.mock("@/actions/workspace", () => ({
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
}));

import { useRouter } from "next/navigation";
import {
  createInviteAction,
  revokeInviteAction,
  type CreateInviteResult,
} from "@/actions/team-invites";
import { changeMemberRole, removeMember } from "@/actions/team-members";
import {
  updateTeam,
  deleteTeam as deleteTeamAction,
} from "@/actions/workspace";
import { useTeamSettings } from "./useTeamSettings";

const mockedRouter = vi.mocked(useRouter);
const mockedCreate = vi.mocked(createInviteAction);
const mockedRevoke = vi.mocked(revokeInviteAction);
const mockedRemove = vi.mocked(removeMember);
const mockedChange = vi.mocked(changeMemberRole);

function makeRouter() {
  return { refresh: vi.fn(), push: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useTeamSettings.createInvite", () => {
  it("stores newInvite on success and refreshes", async () => {
    const router = makeRouter();
    mockedRouter.mockReturnValue(router as never);
    mockedCreate.mockResolvedValue({
      invite: {
        id: "i1",
        team_id: "t1",
        role: "member",
        email: "a@b.co",
        invited_by: "u1",
        expires_at: "2099-01-01",
        accepted_at: null,
        accepted_by: null,
        revoked_at: null,
        created_at: "2026-01-01",
      },
      rawToken: "tok",
      acceptUrl: "https://x/teams/invite/tok",
      error: null,
    });

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));
    act(() => {
      result.current.createInvite({ email: "a@b.co", role: "member" });
    });

    await waitFor(() =>
      expect(result.current.newInvite?.acceptUrl).toBe(
        "https://x/teams/invite/tok",
      ),
    );
    expect(router.refresh).toHaveBeenCalled();
    expect(result.current.inviteError).toBeNull();
  });

  it("captures error on failure", async () => {
    mockedRouter.mockReturnValue(makeRouter() as never);
    mockedCreate.mockResolvedValue({
      invite: null,
      rawToken: null,
      acceptUrl: null,
      error: "forbidden",
    });

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));
    act(() => {
      result.current.createInvite({ email: "", role: "admin" });
    });

    await waitFor(() => expect(result.current.inviteError).toBe("forbidden"));
    expect(result.current.newInvite).toBeNull();
  });

  it("uses fallback error when invite is null with no error message", async () => {
    mockedRouter.mockReturnValue(makeRouter() as never);
    mockedCreate.mockResolvedValue({
      invite: null,
      rawToken: null,
      acceptUrl: null,
      error: null,
    } as unknown as CreateInviteResult);

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));
    act(() => {
      result.current.createInvite({ email: "", role: "admin" });
    });

    await waitFor(() =>
      expect(result.current.inviteError).toBe("Failed to create invite"),
    );
  });

  it("dismissNewInvite clears state", async () => {
    mockedRouter.mockReturnValue(makeRouter() as never);
    mockedCreate.mockResolvedValue({
      invite: {
        id: "i2",
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
      rawToken: "tk",
      acceptUrl: "https://x/teams/invite/tk",
      error: null,
    });

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));
    act(() => {
      result.current.createInvite({ email: "", role: "member" });
    });
    await waitFor(() => expect(result.current.newInvite).not.toBeNull());

    act(() => {
      result.current.dismissNewInvite();
    });
    expect(result.current.newInvite).toBeNull();
  });
});

describe("useTeamSettings.revoke", () => {
  it("clears newInvite when revoking the same id", async () => {
    mockedRouter.mockReturnValue(makeRouter() as never);
    mockedCreate.mockResolvedValue({
      invite: {
        id: "i-new",
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
      rawToken: "tk",
      acceptUrl: "https://x/teams/invite/tk",
      error: null,
    });
    mockedRevoke.mockResolvedValue({ ok: true, error: null });

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));
    act(() => {
      result.current.createInvite({ email: "", role: "member" });
    });
    await waitFor(() =>
      expect(result.current.newInvite?.inviteId).toBe("i-new"),
    );

    act(() => {
      result.current.revoke("i-new");
    });

    await waitFor(() => expect(result.current.newInvite).toBeNull());
  });

  it("captures revoke error", async () => {
    mockedRouter.mockReturnValue(makeRouter() as never);
    mockedRevoke.mockResolvedValue({ ok: false, error: "not_found" });

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));
    act(() => {
      result.current.revoke("i1");
    });
    await waitFor(() => expect(result.current.revokeError).toBe("not_found"));
  });

  it("refreshes without clearing newInvite when revoking a different invite", async () => {
    const router = makeRouter();
    mockedRouter.mockReturnValue(router as never);
    mockedCreate.mockResolvedValue({
      invite: {
        id: "i-keep",
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
      rawToken: "tk",
      acceptUrl: "https://x/teams/invite/tk",
      error: null,
    });
    mockedRevoke.mockResolvedValue({ ok: true, error: null });

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));

    act(() => {
      result.current.createInvite({ email: "", role: "member" });
    });
    await waitFor(() =>
      expect(result.current.newInvite?.inviteId).toBe("i-keep"),
    );

    act(() => {
      result.current.revoke("i-other");
    });

    await waitFor(() => expect(result.current.isRevoking).toBeNull());
    expect(result.current.newInvite).not.toBeNull();
    expect(result.current.newInvite?.inviteId).toBe("i-keep");
  });
});

describe("useTeamSettings.remove", () => {
  it("calls removeMember and refreshes on success", async () => {
    const router = makeRouter();
    mockedRouter.mockReturnValue(router as never);
    mockedRemove.mockResolvedValue({ ok: true, error: null });

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));
    act(() => {
      result.current.remove("u-target");
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(mockedRemove).toHaveBeenCalledWith("t1", "u-target");
  });

  it("captures remove error", async () => {
    mockedRouter.mockReturnValue(makeRouter() as never);
    mockedRemove.mockResolvedValue({ ok: false, error: "cannot_remove_owner" });

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));
    act(() => {
      result.current.remove("u-owner");
    });
    await waitFor(() =>
      expect(result.current.removeError).toBe("cannot_remove_owner"),
    );
  });
});

describe("useTeamSettings.changeRole", () => {
  it("updates role and refreshes", async () => {
    const router = makeRouter();
    mockedRouter.mockReturnValue(router as never);
    mockedChange.mockResolvedValue({ ok: true, error: null });

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));
    act(() => {
      result.current.changeRole("u2", "admin");
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(mockedChange).toHaveBeenCalledWith("t1", "u2", "admin");
  });

  it("captures change-role error", async () => {
    mockedRouter.mockReturnValue(makeRouter() as never);
    mockedChange.mockResolvedValue({ ok: false, error: "forbidden" });

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));
    act(() => {
      result.current.changeRole("u2", "admin");
    });
    await waitFor(() =>
      expect(result.current.changeRoleError).toBe("forbidden"),
    );
  });
});

const mockedUpdateTeam = vi.mocked(updateTeam);
const mockedDeleteTeam = vi.mocked(deleteTeamAction);

describe("useTeamSettings.renameTeam", () => {
  it("calls updateTeam and refreshes on success", async () => {
    const router = makeRouter();
    mockedRouter.mockReturnValue(router as never);
    mockedUpdateTeam.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));
    act(() => {
      result.current.renameTeam("New Name");
    });

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(mockedUpdateTeam).toHaveBeenCalledWith("t1", { name: "New Name" });
    expect(result.current.renameTeamError).toBeNull();
  });

  it("captures error on rename failure", async () => {
    mockedRouter.mockReturnValue(makeRouter() as never);
    mockedUpdateTeam.mockResolvedValue({ data: null, error: "forbidden" });

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));
    act(() => {
      result.current.renameTeam("X");
    });

    await waitFor(() =>
      expect(result.current.renameTeamError).toBe("forbidden"),
    );
  });
});

describe("useTeamSettings.deleteTeam", () => {
  it("calls deleteTeam and navigates to /teams on success", async () => {
    const router = makeRouter();
    mockedRouter.mockReturnValue(router as never);
    mockedDeleteTeam.mockResolvedValue({
      data: { redirect: "/teams" },
      error: null,
    });

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));
    act(() => {
      result.current.deleteTeam();
    });

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/teams"));
    expect(mockedDeleteTeam).toHaveBeenCalledWith("t1");
    expect(result.current.deleteTeamError).toBeNull();
  });

  it("captures error on delete failure", async () => {
    mockedRouter.mockReturnValue(makeRouter() as never);
    mockedDeleteTeam.mockResolvedValue({ data: null, error: "forbidden" });

    const { result } = renderHook(() => useTeamSettings({ teamId: "t1" }));
    act(() => {
      result.current.deleteTeam();
    });

    await waitFor(() =>
      expect(result.current.deleteTeamError).toBe("forbidden"),
    );
  });
});
