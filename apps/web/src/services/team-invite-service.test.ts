import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("./team-policy-service", async () => {
  const actual = await vi.importActual<typeof import("./team-policy-service")>("./team-policy-service");
  return {
    ...actual,
    assertCan: vi.fn(),
  };
});

import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "./team-policy-service";
import {
  acceptInvite,
  buildInviteAcceptUrl,
  createInvite,
  generateRawInviteToken,
  hashInviteToken,
  listInvites,
  revokeInvite,
  TeamInviteError,
} from "./team-invite-service";

const mockedCreateAdmin = vi.mocked(createAdminClient);
const mockedAssertCan = vi.mocked(assertCan);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe("hashInviteToken", () => {
  it("returns a stable sha256 hex digest", () => {
    expect(hashInviteToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hashInviteToken("abc")).toBe(hashInviteToken("abc"));
  });

  it("differs for different inputs", () => {
    expect(hashInviteToken("abc")).not.toBe(hashInviteToken("abd"));
  });
});

describe("generateRawInviteToken", () => {
  it("returns a base64url string of sufficient length", () => {
    const token = generateRawInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("is unique across calls", () => {
    expect(generateRawInviteToken()).not.toBe(generateRawInviteToken());
  });
});

describe("buildInviteAcceptUrl", () => {
  it("uses NEXT_PUBLIC_APP_URL when set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.synthpress.test";
    expect(buildInviteAcceptUrl("tok")).toBe("https://app.synthpress.test/teams/invite/tok");
  });

  it("strips trailing slash from base url", () => {
    expect(buildInviteAcceptUrl("tok", "https://example.com/")).toBe(
      "https://example.com/teams/invite/tok",
    );
  });

  it("falls back to localhost", () => {
    expect(buildInviteAcceptUrl("tok")).toBe("http://localhost:3000/teams/invite/tok");
  });
});

function makeInsertChain(result: { data: unknown; error: { code?: string; message?: string } | null }) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  return { insert, select, single };
}

describe("createInvite", () => {
  it("rejects owner role at the service layer", async () => {
    await expect(
      createInvite({ teamId: "t1", role: "owner", invitedBy: "u1" }),
    ).rejects.toThrow(/cannot invite owners/);
  });

  it("inserts hashed token and returns raw token + accept URL", async () => {
    const chain = makeInsertChain({
      data: {
        id: "inv-1",
        team_id: "t1",
        role: "member",
        email: "a@b.co",
        invited_by: "u1",
        expires_at: "2099-01-01T00:00:00Z",
        accepted_at: null,
        accepted_by: null,
        revoked_at: null,
        created_at: "2026-01-01",
      },
      error: null,
    });
    const client = { from: vi.fn().mockReturnValue(chain) };
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedAssertCan.mockResolvedValue("admin");

    const result = await createInvite({
      teamId: "t1",
      role: "member",
      email: "  A@B.co ",
      invitedBy: "u1",
    });

    expect(client.from).toHaveBeenCalledWith("team_invites");
    expect(chain.insert).toHaveBeenCalledTimes(1);
    const args = chain.insert.mock.calls[0][0];
    expect(args.team_id).toBe("t1");
    expect(args.role).toBe("member");
    expect(args.email).toBe("a@b.co");
    expect(args.invited_by).toBe("u1");
    expect(args.token_hash).toBe(hashInviteToken(result.rawToken));
    expect(result.acceptUrl).toMatch(/\/teams\/invite\/[A-Za-z0-9_-]+$/);
    expect(result.invite.id).toBe("inv-1");
  });

  it("translates duplicate-pending error", async () => {
    const chain = makeInsertChain({ data: null, error: { code: "23505", message: "dup" } });
    const client = { from: vi.fn().mockReturnValue(chain) };
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedAssertCan.mockResolvedValue("admin");

    await expect(
      createInvite({ teamId: "t1", role: "member", email: "a@b.co", invitedBy: "u1" }),
    ).rejects.toThrow(/already pending/);
  });

  it("propagates unknown insert errors", async () => {
    const chain = makeInsertChain({ data: null, error: { code: "boom", message: "x" } });
    const client = { from: vi.fn().mockReturnValue(chain) };
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedAssertCan.mockResolvedValue("owner");

    await expect(
      createInvite({ teamId: "t1", role: "member", invitedBy: "u1" }),
    ).rejects.toEqual({ code: "boom", message: "x" });
  });

  it("propagates assertCan permission errors", async () => {
    mockedAssertCan.mockRejectedValue(new TeamPermissionError("forbidden", "invite_member", "member"));
    mockedCreateAdmin.mockReturnValue({ from: vi.fn() } as never);

    await expect(
      createInvite({ teamId: "t1", role: "member", invitedBy: "u1" }),
    ).rejects.toBeInstanceOf(TeamPermissionError);
  });
});

interface InviteRow {
  id: string;
  team_id: string;
  role: "owner" | "admin" | "member";
  email: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

function makeAcceptClient(opts: {
  invite: InviteRow | null;
  existingMember?: { role: "owner" | "admin" | "member" } | null;
  insertError?: { code?: string; message?: string } | null;
  updateError?: { message?: string } | null;
}) {
  const inviteSelectMaybeSingle = vi.fn().mockResolvedValue({ data: opts.invite, error: null });
  const inviteSelectEq = vi.fn().mockReturnValue({ maybeSingle: inviteSelectMaybeSingle });
  const inviteSelect = vi.fn().mockReturnValue({ eq: inviteSelectEq });

  const memberSelectMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.existingMember ?? null, error: null });
  const memberSelectEqInner = vi.fn().mockReturnValue({ maybeSingle: memberSelectMaybeSingle });
  const memberSelectEqOuter = vi.fn().mockReturnValue({ eq: memberSelectEqInner });
  const memberSelect = vi.fn().mockReturnValue({ eq: memberSelectEqOuter });

  const memberInsert = vi.fn().mockResolvedValue({ error: opts.insertError ?? null });

  const inviteUpdateEq = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
  const inviteUpdate = vi.fn().mockReturnValue({ eq: inviteUpdateEq });

  const client = {
    from: vi.fn((table: string) => {
      if (table === "team_invites") {
        return { select: inviteSelect, update: inviteUpdate };
      }
      if (table === "team_members") {
        return { select: memberSelect, insert: memberInsert };
      }
      throw new Error(`unexpected from(${table})`);
    }),
  };

  return { client, memberInsert, inviteUpdate, inviteUpdateEq };
}

const VALID_FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const VALID_PAST = new Date(Date.now() - 86_400_000).toISOString();

describe("acceptInvite", () => {
  it("throws not_found for unknown token", async () => {
    const { client } = makeAcceptClient({ invite: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      acceptInvite({ rawToken: "x", userId: "u1", userEmail: "a@b.co" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("throws revoked when invite is revoked", async () => {
    const { client } = makeAcceptClient({
      invite: {
        id: "i1", team_id: "t1", role: "member", email: null,
        expires_at: VALID_FUTURE, accepted_at: null, revoked_at: new Date().toISOString(),
      },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      acceptInvite({ rawToken: "x", userId: "u1", userEmail: "a@b.co" }),
    ).rejects.toMatchObject({ code: "revoked" });
  });

  it("throws already_accepted when accepted_at is set", async () => {
    const { client } = makeAcceptClient({
      invite: {
        id: "i1", team_id: "t1", role: "member", email: null,
        expires_at: VALID_FUTURE, accepted_at: new Date().toISOString(), revoked_at: null,
      },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      acceptInvite({ rawToken: "x", userId: "u1", userEmail: "a@b.co" }),
    ).rejects.toMatchObject({ code: "already_accepted" });
  });

  it("throws expired when past expires_at", async () => {
    const { client } = makeAcceptClient({
      invite: {
        id: "i1", team_id: "t1", role: "member", email: null,
        expires_at: VALID_PAST, accepted_at: null, revoked_at: null,
      },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      acceptInvite({ rawToken: "x", userId: "u1", userEmail: "a@b.co" }),
    ).rejects.toMatchObject({ code: "expired" });
  });

  it("throws wrong_email when invite has email and caller's email differs", async () => {
    const { client } = makeAcceptClient({
      invite: {
        id: "i1", team_id: "t1", role: "member", email: "intended@x.co",
        expires_at: VALID_FUTURE, accepted_at: null, revoked_at: null,
      },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      acceptInvite({ rawToken: "x", userId: "u1", userEmail: "wrong@x.co" }),
    ).rejects.toMatchObject({ code: "wrong_email" });
  });

  it("inserts member, marks accepted, and returns invite role for new member", async () => {
    const { client, memberInsert, inviteUpdate } = makeAcceptClient({
      invite: {
        id: "i1", team_id: "t1", role: "admin", email: null,
        expires_at: VALID_FUTURE, accepted_at: null, revoked_at: null,
      },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await acceptInvite({ rawToken: "x", userId: "u1", userEmail: "a@b.co" });

    expect(memberInsert).toHaveBeenCalledWith({
      team_id: "t1",
      user_id: "u1",
      role: "admin",
    });
    expect(inviteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ accepted_by: "u1", accepted_at: expect.any(String) }),
    );
    expect(result).toEqual({ teamId: "t1", role: "admin" });
  });

  it("matches email case-insensitively and trims whitespace", async () => {
    const { client } = makeAcceptClient({
      invite: {
        id: "i1", team_id: "t1", role: "member", email: "User@Example.COM",
        expires_at: VALID_FUTURE, accepted_at: null, revoked_at: null,
      },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      acceptInvite({ rawToken: "x", userId: "u1", userEmail: "  user@example.com  " }),
    ).resolves.toEqual({ teamId: "t1", role: "member" });
  });

  it("idempotent on already-member: skips insert, marks accepted, returns existing role", async () => {
    const { client, memberInsert, inviteUpdate } = makeAcceptClient({
      invite: {
        id: "i1", team_id: "t1", role: "admin", email: null,
        expires_at: VALID_FUTURE, accepted_at: null, revoked_at: null,
      },
      existingMember: { role: "owner" },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await acceptInvite({ rawToken: "x", userId: "u1", userEmail: "a@b.co" });

    expect(memberInsert).not.toHaveBeenCalled();
    expect(inviteUpdate).toHaveBeenCalled();
    expect(result).toEqual({ teamId: "t1", role: "owner" });
  });

  it("swallows 23505 unique_violation on insert (idempotent re-accept race)", async () => {
    const { client } = makeAcceptClient({
      invite: {
        id: "i1", team_id: "t1", role: "member", email: null,
        expires_at: VALID_FUTURE, accepted_at: null, revoked_at: null,
      },
      insertError: { code: "23505", message: "dup" },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      acceptInvite({ rawToken: "x", userId: "u1", userEmail: "a@b.co" }),
    ).resolves.toEqual({ teamId: "t1", role: "member" });
  });

  it("propagates non-23505 insert errors", async () => {
    const { client } = makeAcceptClient({
      invite: {
        id: "i1", team_id: "t1", role: "member", email: null,
        expires_at: VALID_FUTURE, accepted_at: null, revoked_at: null,
      },
      insertError: { code: "P0500", message: "boom" },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      acceptInvite({ rawToken: "x", userId: "u1", userEmail: "a@b.co" }),
    ).rejects.toMatchObject({ code: "P0500" });
  });

  it("propagates invite lookup errors", async () => {
    const lookupErr = { message: "db connection lost" };
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: lookupErr });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const client = { from: vi.fn().mockReturnValue({ select }) };
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      acceptInvite({ rawToken: "x", userId: "u1", userEmail: "a@b.co" }),
    ).rejects.toEqual(lookupErr);
  });

  it("propagates invite update errors when marking accepted", async () => {
    const { client } = makeAcceptClient({
      invite: {
        id: "i1", team_id: "t1", role: "member", email: null,
        expires_at: VALID_FUTURE, accepted_at: null, revoked_at: null,
      },
      updateError: { message: "update failed" },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      acceptInvite({ rawToken: "x", userId: "u1", userEmail: "a@b.co" }),
    ).rejects.toEqual({ message: "update failed" });
  });
});

describe("revokeInvite", () => {
  function makeRevokeClient(opts: {
    invite: { id: string; team_id: string; accepted_at: string | null; revoked_at: string | null } | null;
    updateError?: { message?: string } | null;
  }) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: opts.invite, error: null });
    const eqSelect = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq: eqSelect });
    const eqUpdate = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
    const update = vi.fn().mockReturnValue({ eq: eqUpdate });
    return { client: { from: vi.fn().mockReturnValue({ select, update }) }, update };
  }

  it("propagates invite lookup errors", async () => {
    const lookupErr = { message: "db error" };
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: lookupErr });
    const eqSelect = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq: eqSelect });
    const client = { from: vi.fn().mockReturnValue({ select }) };
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      revokeInvite({ inviteId: "i1", actorUserId: "u1" }),
    ).rejects.toEqual(lookupErr);
  });

  it("throws not_found when invite missing", async () => {
    const { client } = makeRevokeClient({ invite: null });
    mockedCreateAdmin.mockReturnValue(client as never);
    await expect(revokeInvite({ inviteId: "i1", actorUserId: "u1" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("calls assertCan with revoke_invite", async () => {
    const { client } = makeRevokeClient({
      invite: { id: "i1", team_id: "t1", accepted_at: null, revoked_at: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedAssertCan.mockResolvedValue("admin");

    await revokeInvite({ inviteId: "i1", actorUserId: "u1" });
    expect(mockedAssertCan).toHaveBeenCalledWith("t1", "u1", "revoke_invite", expect.anything());
  });

  it("throws already_accepted when accepted_at is set", async () => {
    const { client } = makeRevokeClient({
      invite: { id: "i1", team_id: "t1", accepted_at: "2026-01", revoked_at: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedAssertCan.mockResolvedValue("owner");

    await expect(revokeInvite({ inviteId: "i1", actorUserId: "u1" })).rejects.toMatchObject({
      code: "already_accepted",
    });
  });

  it("no-ops when already revoked", async () => {
    const { client, update } = makeRevokeClient({
      invite: { id: "i1", team_id: "t1", accepted_at: null, revoked_at: "2026-01" },
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedAssertCan.mockResolvedValue("owner");

    await revokeInvite({ inviteId: "i1", actorUserId: "u1" });
    expect(update).not.toHaveBeenCalled();
  });

  it("updates revoked_at on success", async () => {
    const { client, update } = makeRevokeClient({
      invite: { id: "i1", team_id: "t1", accepted_at: null, revoked_at: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedAssertCan.mockResolvedValue("owner");

    await revokeInvite({ inviteId: "i1", actorUserId: "u1" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ revoked_at: expect.any(String) }));
  });

  it("propagates update errors", async () => {
    const { client } = makeRevokeClient({
      invite: { id: "i1", team_id: "t1", accepted_at: null, revoked_at: null },
      updateError: { message: "boom" },
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedAssertCan.mockResolvedValue("owner");

    await expect(revokeInvite({ inviteId: "i1", actorUserId: "u1" })).rejects.toEqual({
      message: "boom",
    });
  });
});

describe("listInvites", () => {
  function makeListClient(rows: unknown[]) {
    const finalResult = vi.fn().mockResolvedValue({ data: rows, error: null });
    const isAccepted = vi.fn().mockReturnValue({ is: finalResult });
    const order = vi.fn().mockReturnValue({ is: isAccepted });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    return {
      client: { from: vi.fn().mockReturnValue({ select }) },
      finalResult,
      isAccepted,
      order,
      eq,
      select,
    };
  }

  it("filters out accepted/revoked by default", async () => {
    const rows = [{ id: "i1" }];
    const { client, isAccepted } = makeListClient(rows);
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedAssertCan.mockResolvedValue("admin");

    const result = await listInvites({ teamId: "t1", actorUserId: "u1" });
    expect(result).toEqual(rows);
    expect(isAccepted).toHaveBeenCalledWith("accepted_at", null);
  });

  it("returns all invites when includeAccepted is true", async () => {
    const orderResult = vi.fn().mockResolvedValue({ data: [{ id: "i1" }], error: null });
    const order = vi.fn().mockReturnValue(orderResult());
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const client = { from: vi.fn().mockReturnValue({ select }) };
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedAssertCan.mockResolvedValue("admin");

    const result = await listInvites({ teamId: "t1", actorUserId: "u1", includeAccepted: true });
    expect(result).toHaveLength(1);
  });

  it("propagates assertCan permission errors", async () => {
    mockedAssertCan.mockRejectedValue(new TeamPermissionError("forbidden", "list_invites", "member"));
    mockedCreateAdmin.mockReturnValue({ from: vi.fn() } as never);

    await expect(listInvites({ teamId: "t1", actorUserId: "u1" })).rejects.toBeInstanceOf(
      TeamPermissionError,
    );
  });

  it("returns empty array when query data is null", async () => {
    const finalResult = vi.fn().mockResolvedValue({ data: null, error: null });
    const isAccepted = vi.fn().mockReturnValue({ is: finalResult });
    const order = vi.fn().mockReturnValue({ is: isAccepted });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const client = { from: vi.fn().mockReturnValue({ select }) };
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedAssertCan.mockResolvedValue("admin");

    const result = await listInvites({ teamId: "t1", actorUserId: "u1" });
    expect(result).toEqual([]);
  });

  it("propagates query errors", async () => {
    const queryErr = { message: "query failed" };
    const finalResult = vi.fn().mockResolvedValue({ data: null, error: queryErr });
    const isAccepted = vi.fn().mockReturnValue({ is: finalResult });
    const order = vi.fn().mockReturnValue({ is: isAccepted });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const client = { from: vi.fn().mockReturnValue({ select }) };
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedAssertCan.mockResolvedValue("admin");

    await expect(
      listInvites({ teamId: "t1", actorUserId: "u1" }),
    ).rejects.toEqual(queryErr);
  });
});

describe("TeamInviteError", () => {
  it("preserves code and message", () => {
    const err = new TeamInviteError("expired", "expired link");
    expect(err.code).toBe("expired");
    expect(err.message).toBe("expired link");
    expect(err.name).toBe("TeamInviteError");
  });
});
