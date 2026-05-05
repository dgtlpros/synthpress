import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getBalance,
  getRecentTransactions,
  grantTokens,
  recordSubscriptionEvent,
  recordTokenRefund,
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

  it("calls the grant_tokens RPC and returns the new balance", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: 150, error: null }),
    };
    mockedCreateAdmin.mockReturnValue(client as never);

    const newBalance = await grantTokens({
      userId: "user-1",
      amount: 50,
      type: "subscription_grant",
      description: "Pro renewal",
      stripeEventId: "evt_1",
      metadata: { invoice_id: "in_1" },
    });

    expect(newBalance).toBe(150);
    expect(client.rpc).toHaveBeenCalledWith("grant_tokens", {
      p_user_id: "user-1",
      p_amount: 50,
      p_type: "subscription_grant",
      p_description: "Pro renewal",
      p_stripe_event_id: "evt_1",
      p_metadata: { invoice_id: "in_1" },
    });
  });

  it("returns null when the RPC reports an idempotent skip", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    mockedCreateAdmin.mockReturnValue(client as never);

    const newBalance = await grantTokens({
      userId: "user-1",
      amount: 100,
      type: "subscription_grant",
      stripeEventId: "evt_dup",
    });

    expect(newBalance).toBeNull();
  });

  it("omits optional args when not provided", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: 100, error: null }),
    };
    mockedCreateAdmin.mockReturnValue(client as never);

    await grantTokens({
      userId: "user-1",
      amount: 100,
      type: "signup_grant",
    });

    expect(client.rpc).toHaveBeenCalledWith("grant_tokens", {
      p_user_id: "user-1",
      p_amount: 100,
      p_type: "signup_grant",
      p_description: undefined,
      p_stripe_event_id: undefined,
      p_metadata: {},
    });
  });

  it("propagates RPC errors", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "amount_must_be_positive" },
      }),
    };
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      grantTokens({ userId: "user-1", amount: 5, type: "adjustment" }),
    ).rejects.toEqual({ message: "amount_must_be_positive" });
  });

  it("uses an injected client when provided", async () => {
    const injected = {
      rpc: vi.fn().mockResolvedValue({ data: 50, error: null }),
    };

    const balance = await grantTokens({
      userId: "user-1",
      amount: 25,
      type: "adjustment",
      client: injected as never,
    });

    expect(balance).toBe(50);
    expect(mockedCreateAdmin).not.toHaveBeenCalled();
  });
});

describe("recordTokenRefund", () => {
  it("rejects non-positive amounts", async () => {
    await expect(
      recordTokenRefund({ userId: "u", amount: 0 }),
    ).rejects.toThrow(/positive/);
  });

  it("calls the record_token_refund RPC and unwraps the JSON result", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: { requested: 1500, deducted: 1500, balance: 3500 },
        error: null,
      }),
    };
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await recordTokenRefund({
      userId: "user-1",
      amount: 1500,
      description: "refund",
      stripeEventId: "evt_refund_1",
      metadata: { stripe_charge_id: "ch_1" },
    });

    expect(result).toEqual({ requested: 1500, deducted: 1500, balance: 3500 });
    expect(client.rpc).toHaveBeenCalledWith("record_token_refund", {
      p_user_id: "user-1",
      p_amount: 1500,
      p_stripe_event_id: "evt_refund_1",
      p_description: "refund",
      p_metadata: { stripe_charge_id: "ch_1" },
    });
  });

  it("returns null when the RPC reports an idempotent skip", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await recordTokenRefund({
      userId: "user-1",
      amount: 100,
      stripeEventId: "evt_dup",
    });

    expect(result).toBeNull();
  });

  it("returns the clamped result when the RPC reports a partial deduction", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: { requested: 5000, deducted: 200, balance: 0 },
        error: null,
      }),
    };
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await recordTokenRefund({
      userId: "user-1",
      amount: 5000,
      stripeEventId: "evt_partial",
    });

    expect(result).toEqual({ requested: 5000, deducted: 200, balance: 0 });
  });

  it("returns the zero-deduction result when nothing is left to revoke", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: { requested: 1000, deducted: 0, balance: 0 },
        error: null,
      }),
    };
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await recordTokenRefund({
      userId: "user-1",
      amount: 1000,
    });

    expect(result).toEqual({ requested: 1000, deducted: 0, balance: 0 });
  });

  it("propagates RPC errors", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "amount_must_be_positive" },
      }),
    };
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      recordTokenRefund({ userId: "user-1", amount: 100 }),
    ).rejects.toEqual({ message: "amount_must_be_positive" });
  });
});

describe("recordSubscriptionEvent", () => {
  it("inserts a 0-amount audit row and returns true", async () => {
    const client = makeClient({
      token_transactions: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const inserted = await recordSubscriptionEvent({
      userId: "u1",
      type: "subscription_canceled",
      description: "Subscription scheduled to end on June 5, 2026",
      stripeEventId: "evt_xxx::canceled",
      metadata: { plan_key: "scale" },
    });

    expect(inserted).toBe(true);
    expect(client.__chains.token_transactions.insert).toHaveBeenCalledWith({
      user_id: "u1",
      amount: 0,
      type: "subscription_canceled",
      description: "Subscription scheduled to end on June 5, 2026",
      stripe_event_id: "evt_xxx::canceled",
      metadata: { plan_key: "scale" },
    });
  });

  it("skips and returns false when the event was already recorded", async () => {
    const client = makeClient({
      token_transactions: { data: { id: "existing" }, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const inserted = await recordSubscriptionEvent({
      userId: "u1",
      type: "subscription_resumed",
      description: "Subscription resumed",
      stripeEventId: "evt_dup::resumed",
    });

    expect(inserted).toBe(false);
    expect(client.__chains.token_transactions.insert).not.toHaveBeenCalled();
  });

  it("treats a unique-violation race as an idempotent skip", async () => {
    const client = makeClient({
      token_transactions: { data: null, error: null },
    });
    client.__chains.token_transactions.insert = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "23505" } });
    mockedCreateAdmin.mockReturnValue(client as never);

    const inserted = await recordSubscriptionEvent({
      userId: "u1",
      type: "plan_downgraded",
      description: "Plan changed from Scale to Pro",
      stripeEventId: "evt_race::downgraded",
    });

    expect(inserted).toBe(false);
  });

  it("propagates non-23505 insert errors", async () => {
    const client = makeClient({
      token_transactions: { data: null, error: null },
    });
    client.__chains.token_transactions.insert = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "42601", message: "boom" } });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      recordSubscriptionEvent({
        userId: "u1",
        type: "subscription_canceled",
        description: "X",
        stripeEventId: "evt_err::canceled",
      }),
    ).rejects.toEqual({ code: "42601", message: "boom" });
  });

  it("uses an empty metadata object when none is provided", async () => {
    const client = makeClient({
      token_transactions: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await recordSubscriptionEvent({
      userId: "u1",
      type: "subscription_canceled",
      description: "X",
      stripeEventId: "evt_no_meta::canceled",
    });

    expect(client.__chains.token_transactions.insert).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: {} }),
    );
  });

  it("uses an injected client when provided", async () => {
    const injected = makeClient({
      token_transactions: { data: null, error: null },
    });
    await recordSubscriptionEvent({
      userId: "u1",
      type: "subscription_resumed",
      description: "Y",
      stripeEventId: "evt_inj::resumed",
      client: injected as never,
    });
    expect(injected.__chains.token_transactions.insert).toHaveBeenCalled();
    expect(mockedCreateAdmin).not.toHaveBeenCalled();
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
