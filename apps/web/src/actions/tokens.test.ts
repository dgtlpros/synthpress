import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/services/token-service", () => ({
  getBalance: vi.fn(),
  consumeTokens: vi.fn(),
  getRecentTransactions: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import {
  getBalance,
  consumeTokens as consumeTokensService,
  getRecentTransactions,
} from "@/services/token-service";
import {
  getTokenBalance,
  consumeTokens,
  getTokenTransactions,
} from "./tokens";

const mockedCreateClient = vi.mocked(createClient);
const mockedGetBalance = vi.mocked(getBalance);
const mockedConsume = vi.mocked(consumeTokensService);
const mockedRecent = vi.mocked(getRecentTransactions);

function mockUser(user: { id: string } | null) {
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTokenBalance", () => {
  it("returns balance for authenticated user", async () => {
    mockUser({ id: "u1" });
    mockedGetBalance.mockResolvedValue(150);
    const result = await getTokenBalance();
    expect(result).toEqual({ balance: 150 });
    expect(mockedGetBalance).toHaveBeenCalledWith("u1");
  });

  it("returns error when not signed in", async () => {
    mockUser(null);
    const result = await getTokenBalance();
    expect(result).toEqual({ error: "Not signed in" });
  });

  it("returns error message when service throws", async () => {
    mockUser({ id: "u1" });
    mockedGetBalance.mockRejectedValue(new Error("db down"));
    const result = await getTokenBalance();
    expect(result).toEqual({ error: "db down" });
  });

  it("returns generic error on non-Error rejection", async () => {
    mockUser({ id: "u1" });
    mockedGetBalance.mockRejectedValue("oops");
    const result = await getTokenBalance();
    expect(result).toEqual({ error: "Failed to load balance" });
  });
});

describe("consumeTokens", () => {
  it("returns new balance on success", async () => {
    mockUser({ id: "u1" });
    mockedConsume.mockResolvedValue(95);
    const result = await consumeTokens(5, "openai");
    expect(result).toEqual({ balance: 95 });
    expect(mockedConsume).toHaveBeenCalledWith({
      userId: "u1",
      amount: 5,
      description: "openai",
    });
  });

  it("returns error when not signed in", async () => {
    mockUser(null);
    const result = await consumeTokens(1);
    expect(result).toEqual({ error: "Not signed in" });
  });

  it("returns insufficient_tokens code on insufficient balance", async () => {
    mockUser({ id: "u1" });
    mockedConsume.mockRejectedValue(new Error("insufficient_tokens"));
    const result = await consumeTokens(1000);
    expect(result).toEqual({ error: "insufficient_tokens" });
  });

  it("returns the error message on other failures", async () => {
    mockUser({ id: "u1" });
    mockedConsume.mockRejectedValue(new Error("db down"));
    const result = await consumeTokens(1);
    expect(result).toEqual({ error: "db down" });
  });

  it("returns generic error on non-Error rejection", async () => {
    mockUser({ id: "u1" });
    mockedConsume.mockRejectedValue("oops");
    const result = await consumeTokens(1);
    expect(result).toEqual({ error: "Failed to consume tokens" });
  });
});

describe("getTokenTransactions", () => {
  it("returns transactions for authenticated user", async () => {
    mockUser({ id: "u1" });
    const txs = [{ id: "t1", amount: 100 } as never];
    mockedRecent.mockResolvedValue(txs);
    const result = await getTokenTransactions();
    expect(result).toEqual({ transactions: txs });
    expect(mockedRecent).toHaveBeenCalledWith("u1", { limit: 10 });
  });

  it("respects custom limit", async () => {
    mockUser({ id: "u1" });
    mockedRecent.mockResolvedValue([]);
    await getTokenTransactions(5);
    expect(mockedRecent).toHaveBeenCalledWith("u1", { limit: 5 });
  });

  it("returns error when not signed in", async () => {
    mockUser(null);
    const result = await getTokenTransactions();
    expect(result).toEqual({ error: "Not signed in" });
  });

  it("returns error message on service failure", async () => {
    mockUser({ id: "u1" });
    mockedRecent.mockRejectedValue(new Error("db down"));
    const result = await getTokenTransactions();
    expect(result).toEqual({ error: "db down" });
  });

  it("returns generic error on non-Error rejection", async () => {
    mockUser({ id: "u1" });
    mockedRecent.mockRejectedValue("oops");
    const result = await getTokenTransactions();
    expect(result).toEqual({ error: "Failed to load transactions" });
  });
});
