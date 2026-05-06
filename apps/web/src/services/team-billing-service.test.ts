import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("./billing-service", () => ({
  getActiveSubscription: vi.fn(),
}));

vi.mock("./token-service", () => ({
  getBalance: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveSubscription } from "./billing-service";
import { getBalance } from "./token-service";
import { consumeTeamTokens, getTeamPlan } from "./team-billing-service";

const mockedCreateAdmin = vi.mocked(createAdminClient);
const mockedGetActiveSubscription = vi.mocked(getActiveSubscription);
const mockedGetBalance = vi.mocked(getBalance);

interface MockClient {
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
}

function makeClient(): MockClient {
  return {
    rpc: vi.fn(),
    from: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("consumeTeamTokens", () => {
  it("rejects non-positive amounts before calling supabase", async () => {
    await expect(
      consumeTeamTokens({ teamId: "t1", amount: 0, actingUserId: "u1" }),
    ).rejects.toThrow(/positive/);
    expect(mockedCreateAdmin).not.toHaveBeenCalled();
  });

  it("calls consume_team_tokens with all parameters and returns balance", async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: 90, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const balance = await consumeTeamTokens({
      teamId: "t1",
      amount: 5,
      actingUserId: "u-acting",
      description: "Run automation",
      metadata: { project_id: "p1", blog_id: "b1" },
      idempotencyKey: "job-123",
    });

    expect(balance).toBe(90);
    expect(client.rpc).toHaveBeenCalledWith("consume_team_tokens", {
      p_team_id: "t1",
      p_amount: 5,
      p_acting_user_id: "u-acting",
      p_description: "Run automation",
      p_metadata: { project_id: "p1", blog_id: "b1" },
      p_idempotency_key: "job-123",
    });
  });

  it("uses an injected client when provided", async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: 12, error: null });

    const balance = await consumeTeamTokens({
      teamId: "t1",
      amount: 3,
      actingUserId: "u1",
      client: client as never,
    });

    expect(balance).toBe(12);
    expect(mockedCreateAdmin).not.toHaveBeenCalled();
  });

  it("translates insufficient_tokens to a typed error", async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: null, error: { message: "insufficient_tokens" } });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      consumeTeamTokens({ teamId: "t1", amount: 1000, actingUserId: "u1" }),
    ).rejects.toThrow("insufficient_tokens");
  });

  it("translates team_has_no_billing_user to a typed error", async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: null, error: { message: "team_has_no_billing_user" } });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      consumeTeamTokens({ teamId: "t1", amount: 1, actingUserId: "u1" }),
    ).rejects.toThrow("team_has_no_billing_user");
  });

  it("translates amount_must_be_positive errors raised by the RPC", async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: null, error: { message: "amount_must_be_positive" } });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      consumeTeamTokens({ teamId: "t1", amount: 1, actingUserId: "u1" }),
    ).rejects.toThrow("amount_must_be_positive");
  });

  it("rethrows unknown supabase errors", async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "P0500" } });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      consumeTeamTokens({ teamId: "t1", amount: 1, actingUserId: "u1" }),
    ).rejects.toEqual({ message: "boom", code: "P0500" });
  });

  it("returns 0 when RPC data is null (idempotent no-op short-circuit)", async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const balance = await consumeTeamTokens({
      teamId: "t1",
      amount: 1,
      actingUserId: "u1",
    });
    expect(balance).toBe(0);
  });

  it("passes empty metadata when none provided", async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: 7, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    await consumeTeamTokens({ teamId: "t1", amount: 1, actingUserId: "u1" });

    expect(client.rpc).toHaveBeenCalledWith(
      "consume_team_tokens",
      expect.objectContaining({ p_metadata: {}, p_idempotency_key: undefined, p_description: undefined }),
    );
  });
});

describe("getTeamPlan", () => {
  function mockTeamRow(billingUserId: string | null) {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: billingUserId ? { billing_user_id: billingUserId } : null,
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const client = {
      from: vi.fn().mockReturnValue({ select }),
    };
    return { client, maybeSingle, select, eq };
  }

  it("returns null when team has no billing user", async () => {
    const { client } = mockTeamRow(null);
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await getTeamPlan("t1");
    expect(result).toBeNull();
  });

  it("returns owner id, plan, status, and balance when subscription exists", async () => {
    const { client } = mockTeamRow("owner-1");
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedGetActiveSubscription.mockResolvedValue({
      plan_key: "pro",
      status: "active",
    } as never);
    mockedGetBalance.mockResolvedValue(420);

    const result = await getTeamPlan("t1");

    expect(result).toEqual({
      ownerId: "owner-1",
      planKey: "pro",
      status: "active",
      balance: 420,
    });
    expect(mockedGetActiveSubscription).toHaveBeenCalledWith("owner-1", client);
    expect(mockedGetBalance).toHaveBeenCalledWith("owner-1", client);
  });

  it("returns nulls for plan and status when no active subscription", async () => {
    const { client } = mockTeamRow("owner-2");
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedGetActiveSubscription.mockResolvedValue(null);
    mockedGetBalance.mockResolvedValue(100);

    const result = await getTeamPlan("t2");
    expect(result).toEqual({
      ownerId: "owner-2",
      planKey: null,
      status: null,
      balance: 100,
    });
  });

  it("propagates supabase errors when reading the team", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "db down" } });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const client = { from: vi.fn().mockReturnValue({ select }) };
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(getTeamPlan("t1")).rejects.toEqual({ message: "db down" });
  });

  it("uses an injected client", async () => {
    const { client } = mockTeamRow("owner-3");
    mockedGetActiveSubscription.mockResolvedValue(null);
    mockedGetBalance.mockResolvedValue(0);

    await getTeamPlan("t3", client as never);
    expect(mockedCreateAdmin).not.toHaveBeenCalled();
  });
});
