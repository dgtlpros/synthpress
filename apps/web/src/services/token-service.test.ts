import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getBalance,
  getRecentTransactions,
  grantTokens,
  consumeTokens,
} from "./token-service";

const mockedCreateAdmin = vi.mocked(createAdminClient);

type ChainResult<T> = { data: T; error: { code?: string; message?: string } | null };

function makeQueryChain<T>(result: ChainResult<T>) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockResolvedValue(result),
    upsert: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

interface MockClient {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  __chains: Record<string, ReturnType<typeof makeQueryChain>>;
}

function makeClient(table: Record<string, ChainResult<unknown>>): MockClient {
  const chains: Record<string, ReturnType<typeof makeQueryChain>> = {};
  for (const [name, result] of Object.entries(table)) {
    chains[name] = makeQueryChain(result);
  }
  const client = {
    from: vi.fn((name: string) => {
      if (!chains[name]) {
        chains[name] = makeQueryChain({ data: null, error: null });
      }
      return chains[name];
    }),
    rpc: vi.fn(),
    __chains: chains,
  };
  return client as unknown as MockClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getBalance", () => {
  it("returns the user's balance", async () => {
    const client = makeClient({
      token_balances: { data: { balance: 250 }, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const balance = await getBalance("user-1");

    expect(balance).toBe(250);
    expect(client.from).toHaveBeenCalledWith("token_balances");
  });

  it("returns 0 when there is no balance row", async () => {
    const client = makeClient({
      token_balances: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const balance = await getBalance("user-1");
    expect(balance).toBe(0);
  });

  it("throws when supabase returns an error", async () => {
    const client = makeClient({
      token_balances: { data: null, error: { message: "boom" } },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(getBalance("user-1")).rejects.toEqual({ message: "boom" });
  });

  it("uses an injected client when provided", async () => {
    const injected = makeClient({
      token_balances: { data: { balance: 50 }, error: null },
    });

    const balance = await getBalance("user-1", injected as never);
    expect(balance).toBe(50);
    expect(mockedCreateAdmin).not.toHaveBeenCalled();
  });
});

describe("getRecentTransactions", () => {
  it("returns recent transactions ordered desc", async () => {
    const rows = [
      { id: "t1", amount: 100, type: "signup_grant", user_id: "user-1" },
    ];
    const client = makeClient({
      token_transactions: { data: rows, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await getRecentTransactions("user-1");
    expect(result).toEqual(rows);
    expect(client.__chains.token_transactions.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(client.__chains.token_transactions.limit).toHaveBeenCalledWith(10);
  });

  it("respects a custom limit", async () => {
    const client = makeClient({
      token_transactions: { data: [], error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await getRecentTransactions("user-1", { limit: 5 });
    expect(client.__chains.token_transactions.limit).toHaveBeenCalledWith(5);
  });

  it("returns [] when supabase gives null data", async () => {
    const client = makeClient({
      token_transactions: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await getRecentTransactions("user-1");
    expect(result).toEqual([]);
  });

  it("throws when supabase returns an error", async () => {
    const client = makeClient({
      token_transactions: { data: null, error: { message: "boom" } },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(getRecentTransactions("user-1")).rejects.toEqual({ message: "boom" });
  });
});

describe("grantTokens", () => {
  it("rejects non-positive amounts", async () => {
    await expect(
      grantTokens({ userId: "u", amount: 0, type: "adjustment" }),
    ).rejects.toThrow(/positive/);
  });

  it("inserts a transaction and increments the balance", async () => {
    const client = makeClient({
      token_transactions: { data: null, error: null },
      token_balances: { data: { balance: 100 }, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const newBalance = await grantTokens({
      userId: "user-1",
      amount: 50,
      type: "subscription_grant",
      description: "Pro renewal",
      metadata: { invoice_id: "in_1" },
    });

    expect(newBalance).toBe(150);
    expect(client.__chains.token_transactions.insert).toHaveBeenCalledWith({
      user_id: "user-1",
      amount: 50,
      type: "subscription_grant",
      description: "Pro renewal",
      stripe_event_id: null,
      metadata: { invoice_id: "in_1" },
    });
    expect(client.__chains.token_balances.upsert).toHaveBeenCalledWith(
      { user_id: "user-1", balance: 150 },
      { onConflict: "user_id" },
    );
  });

  it("starts the balance at 0 when no row yet exists", async () => {
    const client = makeClient({
      token_transactions: { data: null, error: null },
      token_balances: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const newBalance = await grantTokens({
      userId: "user-1",
      amount: 100,
      type: "signup_grant",
    });

    expect(newBalance).toBe(100);
  });

  it("returns null and skips the grant when stripe event already processed", async () => {
    const client = makeClient({
      token_transactions: { data: { id: "existing" }, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const newBalance = await grantTokens({
      userId: "user-1",
      amount: 100,
      type: "subscription_grant",
      stripeEventId: "evt_1",
    });

    expect(newBalance).toBeNull();
    expect(client.__chains.token_transactions.insert).not.toHaveBeenCalled();
  });

  it("returns null when the unique constraint fires during the insert race", async () => {
    const client = makeClient({
      token_transactions: { data: null, error: null },
      token_balances: { data: { balance: 0 }, error: null },
    });
    client.__chains.token_transactions.insert = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "23505" } });
    mockedCreateAdmin.mockReturnValue(client as never);

    const newBalance = await grantTokens({
      userId: "user-1",
      amount: 100,
      type: "subscription_grant",
      stripeEventId: "evt_2",
    });

    expect(newBalance).toBeNull();
    expect(client.__chains.token_balances.upsert).not.toHaveBeenCalled();
  });

  it("propagates non-23505 insert errors", async () => {
    const client = makeClient({
      token_balances: { data: { balance: 0 }, error: null },
    });
    client.__chains.token_transactions = makeQueryChain({ data: null, error: null });
    client.__chains.token_transactions.insert = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "42601", message: "syntax" } });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      grantTokens({ userId: "user-1", amount: 5, type: "adjustment" }),
    ).rejects.toEqual({ code: "42601", message: "syntax" });
  });

  it("propagates balance upsert errors", async () => {
    const client = makeClient({
      token_transactions: { data: null, error: null },
      token_balances: { data: { balance: 0 }, error: null },
    });
    client.__chains.token_balances.upsert = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "boom" } });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      grantTokens({ userId: "user-1", amount: 5, type: "adjustment" }),
    ).rejects.toEqual({ message: "boom" });
  });
});

describe("consumeTokens", () => {
  it("rejects non-positive amounts", async () => {
    await expect(
      consumeTokens({ userId: "user-1", amount: 0 }),
    ).rejects.toThrow(/positive/);
  });

  it("calls the consume_tokens RPC and returns the new balance", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: 950, error: null }),
    };
    mockedCreateAdmin.mockReturnValue(client as never);

    const balance = await consumeTokens({
      userId: "user-1",
      amount: 50,
      description: "openai chat",
    });

    expect(balance).toBe(950);
    expect(client.rpc).toHaveBeenCalledWith("consume_tokens", {
      p_user_id: "user-1",
      p_amount: 50,
      p_description: "openai chat",
    });
  });

  it("returns 0 when rpc data is null", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    mockedCreateAdmin.mockReturnValue(client as never);

    const balance = await consumeTokens({ userId: "user-1", amount: 10 });
    expect(balance).toBe(0);
  });

  it("throws insufficient_tokens when rpc reports it", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "insufficient_tokens" },
      }),
    };
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      consumeTokens({ userId: "user-1", amount: 1000 }),
    ).rejects.toThrow("insufficient_tokens");
  });

  it("propagates other rpc errors", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "different error" },
      }),
    };
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      consumeTokens({ userId: "user-1", amount: 1 }),
    ).rejects.toEqual({ message: "different error" });
  });
});
