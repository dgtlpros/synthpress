import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/services/team-policy-service", async () => {
  const actual = await vi.importActual<typeof import("@/services/team-policy-service")>(
    "@/services/team-policy-service",
  );
  return { ...actual, assertCan: vi.fn() };
});

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import { changeMemberRole, removeMember } from "./team-members";

const mockedCreate = vi.mocked(createClient);
const mockedAdmin = vi.mocked(createAdminClient);
const mockedAssertCan = vi.mocked(assertCan);

function mockUser(user: { id: string } | null) {
  mockedCreate.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never);
}

function makeAdminFor(opts: {
  selectRole?: "owner" | "admin" | "member" | null;
  deleteError?: { message: string } | null;
  updateError?: { message: string } | null;
}) {
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.selectRole ? { role: opts.selectRole } : null, error: null });
  const eqInner = vi.fn().mockReturnValue({ maybeSingle });
  const eqOuter = vi.fn().mockReturnValue({ eq: eqInner });
  const select = vi.fn().mockReturnValue({ eq: eqOuter });

  const eqDelInner = vi.fn().mockResolvedValue({ error: opts.deleteError ?? null });
  const eqDelOuter = vi.fn().mockReturnValue({ eq: eqDelInner });
  const del = vi.fn().mockReturnValue({ eq: eqDelOuter });

  const eqUpdInner = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
  const eqUpdOuter = vi.fn().mockReturnValue({ eq: eqUpdInner });
  const update = vi.fn().mockReturnValue({ eq: eqUpdOuter });

  return {
    admin: { from: vi.fn().mockReturnValue({ select, delete: del, update }) },
    select,
    del,
    update,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("removeMember", () => {
  it("rejects empty args", async () => {
    const result = await removeMember("", "");
    expect(result.error).toBe("teamId and targetUserId are required");
  });

  it("rejects when not signed in", async () => {
    mockUser(null);
    const result = await removeMember("t1", "u2");
    expect(result.error).toBe("Not signed in");
  });

  it("forbids removing the owner", async () => {
    mockUser({ id: "u1" });
    const { admin } = makeAdminFor({ selectRole: "owner" });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockResolvedValue("admin");

    const result = await removeMember("t1", "u-owner");
    expect(result.error).toBe("cannot_remove_owner");
  });

  it("returns not_a_member when target absent", async () => {
    mockUser({ id: "u1" });
    const { admin } = makeAdminFor({ selectRole: null });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockResolvedValue("owner");

    const result = await removeMember("t1", "u-missing");
    expect(result.error).toBe("not_a_member");
  });

  it("removes member on success", async () => {
    mockUser({ id: "u1" });
    const { admin, del } = makeAdminFor({ selectRole: "member" });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockResolvedValue("owner");

    const result = await removeMember("t1", "u2");
    expect(result).toEqual({ ok: true, error: null });
    expect(del).toHaveBeenCalled();
  });

  it("returns permission error code", async () => {
    mockUser({ id: "u1" });
    const { admin } = makeAdminFor({ selectRole: "member" });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockRejectedValue(new TeamPermissionError("forbidden", "remove_member", "member"));

    const result = await removeMember("t1", "u2");
    expect(result.error).toBe("forbidden");
  });

  it("returns delete error message", async () => {
    mockUser({ id: "u1" });
    const { admin } = makeAdminFor({ selectRole: "member", deleteError: { message: "boom" } });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockResolvedValue("owner");

    const result = await removeMember("t1", "u2");
    expect(result.error).toBe("boom");
  });

  it("returns generic error when service throws non-Error rejection", async () => {
    mockUser({ id: "u1" });
    const { admin } = makeAdminFor({ selectRole: "member" });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockRejectedValue("unexpected string error");

    const result = await removeMember("t1", "u2");
    expect(result.error).toBe("Failed to remove member");
  });

  it("returns error message when a regular Error is thrown", async () => {
    mockUser({ id: "u1" });
    const { admin } = makeAdminFor({ selectRole: "member" });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockRejectedValue(new Error("unexpected failure"));

    const result = await removeMember("t1", "u2");
    expect(result.error).toBe("unexpected failure");
  });
});

describe("changeMemberRole", () => {
  it("rejects empty args", async () => {
    const result = await changeMemberRole("", "u2", "admin");
    expect(result.error).toBe("teamId and targetUserId are required");
  });

  it("rejects newRole='owner'", async () => {
    const result = await changeMemberRole("t1", "u2", "owner" as never);
    expect(result.error).toBe("newRole must be admin or member");
  });

  it("rejects when not signed in", async () => {
    mockUser(null);
    const result = await changeMemberRole("t1", "u2", "admin");
    expect(result.error).toBe("Not signed in");
  });

  it("forbids changing the owner's role", async () => {
    mockUser({ id: "u1" });
    const { admin } = makeAdminFor({ selectRole: "owner" });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockResolvedValue("owner");

    const result = await changeMemberRole("t1", "u-owner", "admin");
    expect(result.error).toBe("cannot_change_owner_role");
  });

  it("no-ops when target already has the new role", async () => {
    mockUser({ id: "u1" });
    const { admin, update } = makeAdminFor({ selectRole: "admin" });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockResolvedValue("owner");

    const result = await changeMemberRole("t1", "u2", "admin");
    expect(result).toEqual({ ok: true, error: null });
    expect(update).not.toHaveBeenCalled();
  });

  it("returns not_a_member when target missing", async () => {
    mockUser({ id: "u1" });
    const { admin } = makeAdminFor({ selectRole: null });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockResolvedValue("owner");

    const result = await changeMemberRole("t1", "u2", "admin");
    expect(result.error).toBe("not_a_member");
  });

  it("updates role on success", async () => {
    mockUser({ id: "u1" });
    const { admin, update } = makeAdminFor({ selectRole: "member" });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockResolvedValue("owner");

    const result = await changeMemberRole("t1", "u2", "admin");
    expect(result).toEqual({ ok: true, error: null });
    expect(update).toHaveBeenCalledWith({ role: "admin" });
  });

  it("returns permission error code", async () => {
    mockUser({ id: "u1" });
    const { admin } = makeAdminFor({ selectRole: "member" });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockRejectedValue(new TeamPermissionError("forbidden", "change_role", "admin"));

    const result = await changeMemberRole("t1", "u2", "admin");
    expect(result.error).toBe("forbidden");
  });

  it("returns update error message", async () => {
    mockUser({ id: "u1" });
    const { admin } = makeAdminFor({ selectRole: "member", updateError: { message: "boom" } });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockResolvedValue("owner");

    const result = await changeMemberRole("t1", "u2", "admin");
    expect(result.error).toBe("boom");
  });

  it("returns generic error when service throws non-Error rejection", async () => {
    mockUser({ id: "u1" });
    const { admin } = makeAdminFor({ selectRole: "member" });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockRejectedValue("non-Error throw");

    const result = await changeMemberRole("t1", "u2", "admin");
    expect(result.error).toBe("Failed to change role");
  });

  it("returns error message when a regular Error is thrown", async () => {
    mockUser({ id: "u1" });
    const { admin } = makeAdminFor({ selectRole: "member" });
    mockedAdmin.mockReturnValue(admin as never);
    mockedAssertCan.mockRejectedValue(new Error("unexpected failure"));

    const result = await changeMemberRole("t1", "u2", "admin");
    expect(result.error).toBe("unexpected failure");
  });
});
