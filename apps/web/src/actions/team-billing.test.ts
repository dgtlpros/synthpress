import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

vi.mock("@/services/team-policy-service", async () => {
  const actual = await vi.importActual<typeof import("@/services/team-policy-service")>(
    "@/services/team-policy-service",
  );
  return { ...actual, assertCan: vi.fn() };
});

vi.mock("@/services/team-billing-service", () => ({
  consumeTeamTokens: vi.fn(),
  getTeamPlan: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import {
  consumeTeamTokens as consumeTeamTokensService,
  getTeamPlan as getTeamPlanService,
} from "@/services/team-billing-service";
import { consumeTeamTokens, getTeamBilling } from "./team-billing";

const mockedCreate = vi.mocked(createClient);
const mockedAdmin = vi.mocked(createAdminClient);
const mockedAssertCan = vi.mocked(assertCan);
const mockedConsumeService = vi.mocked(consumeTeamTokensService);
const mockedGetPlanService = vi.mocked(getTeamPlanService);

function mockUser(user: { id: string; email?: string } | null) {
  mockedCreate.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmin.mockReturnValue({} as never);
});

describe("consumeTeamTokens action", () => {
  it("returns error when teamId missing", async () => {
    const result = await consumeTeamTokens({ teamId: "", amount: 5 });
    expect(result.error).toBe("teamId is required");
  });

  it("returns error when amount is non-positive", async () => {
    const result = await consumeTeamTokens({ teamId: "t1", amount: 0 });
    expect(result.error).toBe("amount_must_be_positive");
  });

  it("returns error when not signed in", async () => {
    mockUser(null);
    const result = await consumeTeamTokens({ teamId: "t1", amount: 5 });
    expect(result.error).toBe("Not signed in");
  });

  it("debits and returns balance on success", async () => {
    mockUser({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockedConsumeService.mockResolvedValue(95);

    const result = await consumeTeamTokens({
      teamId: "t1",
      amount: 5,
      description: "auto",
      metadata: { project_id: "p1" },
      idempotencyKey: "job-9",
    });

    expect(result).toEqual({ balance: 95, error: null });
    expect(mockedAssertCan).toHaveBeenCalledWith("t1", "u1", "consume_team_tokens", expect.anything());
    expect(mockedConsumeService).toHaveBeenCalledWith({
      teamId: "t1",
      amount: 5,
      actingUserId: "u1",
      description: "auto",
      metadata: { project_id: "p1" },
      idempotencyKey: "job-9",
      client: expect.anything(),
    });
  });

  it("returns permission error code when not a member", async () => {
    mockUser({ id: "u1" });
    mockedAssertCan.mockRejectedValue(
      new TeamPermissionError("not_a_member", "consume_team_tokens", null),
    );
    const result = await consumeTeamTokens({ teamId: "t1", amount: 5 });
    expect(result.error).toBe("not_a_member");
  });

  it("returns insufficient_tokens code", async () => {
    mockUser({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockedConsumeService.mockRejectedValue(new Error("insufficient_tokens"));
    const result = await consumeTeamTokens({ teamId: "t1", amount: 1000 });
    expect(result.error).toBe("insufficient_tokens");
  });

  it("returns team_has_no_billing_user code", async () => {
    mockUser({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockedConsumeService.mockRejectedValue(new Error("team_has_no_billing_user"));
    const result = await consumeTeamTokens({ teamId: "t1", amount: 5 });
    expect(result.error).toBe("team_has_no_billing_user");
  });

  it("returns generic message on unknown error", async () => {
    mockUser({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockedConsumeService.mockRejectedValue(new Error("db down"));
    const result = await consumeTeamTokens({ teamId: "t1", amount: 5 });
    expect(result.error).toBe("db down");
  });

  it("returns fallback error on non-Error rejection", async () => {
    mockUser({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockedConsumeService.mockRejectedValue("oops");
    const result = await consumeTeamTokens({ teamId: "t1", amount: 5 });
    expect(result.error).toBe("Failed to consume tokens");
  });
});

describe("getTeamBilling action", () => {
  it("returns error when teamId missing", async () => {
    const result = await getTeamBilling("");
    expect(result.error).toBe("teamId is required");
  });

  it("returns error when not signed in", async () => {
    mockUser(null);
    const result = await getTeamBilling("t1");
    expect(result.error).toBe("Not signed in");
  });

  it("returns plan on success", async () => {
    mockUser({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockedGetPlanService.mockResolvedValue({
      ownerId: "owner-1",
      planKey: "pro",
      status: "active",
      balance: 200,
    });

    const result = await getTeamBilling("t1");
    expect(result).toEqual({
      plan: { ownerId: "owner-1", planKey: "pro", status: "active", balance: 200 },
      error: null,
    });
  });

  it("returns team_not_found when service returns null", async () => {
    mockUser({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockedGetPlanService.mockResolvedValue(null);
    const result = await getTeamBilling("t1");
    expect(result.error).toBe("team_not_found");
  });

  it("returns permission error code", async () => {
    mockUser({ id: "u1" });
    mockedAssertCan.mockRejectedValue(
      new TeamPermissionError("not_a_member", "consume_team_tokens", null),
    );
    const result = await getTeamBilling("t1");
    expect(result.error).toBe("not_a_member");
  });

  it("returns generic error on service failure", async () => {
    mockUser({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockedGetPlanService.mockRejectedValue(new Error("boom"));
    const result = await getTeamBilling("t1");
    expect(result.error).toBe("boom");
  });

  it("returns fallback error on non-Error rejection", async () => {
    mockUser({ id: "u1" });
    mockedAssertCan.mockResolvedValue("member");
    mockedGetPlanService.mockRejectedValue("oops");
    const result = await getTeamBilling("t1");
    expect(result.error).toBe("Failed to load team billing");
  });
});
