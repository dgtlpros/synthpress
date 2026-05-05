import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("./stripe-service", () => ({
  findOrCreateCustomer: vi.fn(),
}));

vi.mock("./token-service", () => ({
  grantTokens: vi.fn(),
  recordTokenRefund: vi.fn(),
  recordSubscriptionEvent: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { findOrCreateCustomer } from "./stripe-service";
import {
  grantTokens,
  recordSubscriptionEvent,
  recordTokenRefund,
} from "./token-service";
import {
  getOrCreateStripeCustomer,
  getActiveSubscription,
  getCurrentPlan,
  getPlanByStripePriceId,
  getPlanByKey,
  syncSubscriptionFromStripe,
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
  handleChargeRefunded,
  handleChargeDisputeClosed,
  handleWebhookEvent,
} from "./billing-service";

const mockedCreateAdmin = vi.mocked(createAdminClient);
const mockedFindOrCreate = vi.mocked(findOrCreateCustomer);
const mockedGrantTokens = vi.mocked(grantTokens);
const mockedRecordRefund = vi.mocked(recordTokenRefund);
const mockedRecordEvent = vi.mocked(recordSubscriptionEvent);

type ChainResult<T> = { data: T; error: { code?: string; message?: string } | null };

function makeChain(initial: ChainResult<unknown> = { data: null, error: null }) {
  // Mirror Supabase JS's PostgrestBuilder: every filter method returns the
  // same chain so callers can compose, AND the chain itself is thenable so
  // `await chain.filter(...)` resolves directly. Terminal helpers
  // (`maybeSingle`, `insert`, `upsert`) explicitly resolve too.
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue(initial),
    upsert: vi.fn().mockResolvedValue(initial),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(initial),
    filter: vi.fn().mockReturnThis(),
    then: (resolve: (value: ChainResult<unknown>) => unknown) =>
      Promise.resolve(initial).then(resolve),
  };
  // The .update() chain ends with .eq() returning a Promise. Make eq awaitable.
  // We'll do this by overriding eq dynamically below for update test cases.
  return chain;
}

interface MockClient {
  from: ReturnType<typeof vi.fn>;
  __tables: Record<string, ReturnType<typeof makeChain>>;
}

function makeClient(seed: Record<string, ChainResult<unknown>> = {}): MockClient {
  const tables: Record<string, ReturnType<typeof makeChain>> = {};
  for (const [name, result] of Object.entries(seed)) {
    tables[name] = makeChain(result);
  }
  return {
    from: vi.fn((name: string) => {
      if (!tables[name]) tables[name] = makeChain();
      return tables[name];
    }),
    __tables: tables,
  } as unknown as MockClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOrCreateStripeCustomer", () => {
  it("returns existing customer id without calling Stripe", async () => {
    const client = makeClient({
      stripe_customers: { data: { stripe_customer_id: "cus_existing" }, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const id = await getOrCreateStripeCustomer({ userId: "u1", email: "u@test.com" });
    expect(id).toBe("cus_existing");
    expect(mockedFindOrCreate).not.toHaveBeenCalled();
  });

  it("creates a new Stripe customer and persists it when none exists", async () => {
    const client = makeClient({
      stripe_customers: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedFindOrCreate.mockResolvedValue("cus_new");

    const id = await getOrCreateStripeCustomer({ userId: "u1", email: "u@test.com" });
    expect(id).toBe("cus_new");
    expect(mockedFindOrCreate).toHaveBeenCalledWith({ email: "u@test.com", userId: "u1" });
    expect(client.__tables.stripe_customers.insert).toHaveBeenCalledWith({
      user_id: "u1",
      stripe_customer_id: "cus_new",
    });
  });

  it("ignores 23505 unique violation on insert (race-safe)", async () => {
    const client = makeClient({
      stripe_customers: { data: null, error: null },
    });
    client.__tables.stripe_customers.insert = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "23505" } });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedFindOrCreate.mockResolvedValue("cus_race");

    const id = await getOrCreateStripeCustomer({ userId: "u1", email: "u@test.com" });
    expect(id).toBe("cus_race");
  });

  it("propagates non-23505 insert errors", async () => {
    const client = makeClient({
      stripe_customers: { data: null, error: null },
    });
    client.__tables.stripe_customers.insert = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "42601" } });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedFindOrCreate.mockResolvedValue("cus_x");

    await expect(
      getOrCreateStripeCustomer({ userId: "u1", email: "u@test.com" }),
    ).rejects.toEqual({ code: "42601" });
  });

  it("propagates supabase select errors", async () => {
    const client = makeClient({
      stripe_customers: { data: null, error: { message: "boom" } },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      getOrCreateStripeCustomer({ userId: "u1", email: "u@test.com" }),
    ).rejects.toEqual({ message: "boom" });
  });
});

describe("getActiveSubscription", () => {
  it("returns the latest active subscription", async () => {
    const sub = { id: "s1", status: "active", plan_key: "pro" };
    const client = makeClient({
      subscriptions: { data: sub, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await getActiveSubscription("u1");
    expect(result).toEqual(sub);
    expect(client.__tables.subscriptions.in).toHaveBeenCalledWith(
      "status",
      ["active", "trialing", "past_due", "incomplete"],
    );
  });

  it("returns null when no active sub", async () => {
    const client = makeClient({
      subscriptions: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await getActiveSubscription("u1");
    expect(result).toBeNull();
  });

  it("propagates errors", async () => {
    const client = makeClient({
      subscriptions: { data: null, error: { message: "boom" } },
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    await expect(getActiveSubscription("u1")).rejects.toEqual({ message: "boom" });
  });
});

describe("getCurrentPlan", () => {
  it("returns null when no active subscription", async () => {
    const client = makeClient({
      subscriptions: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await getCurrentPlan("u1");
    expect(result).toBeNull();
  });

  it("returns plan + subscription when present", async () => {
    const sub = { id: "s1", plan_key: "pro" };
    const plan = { key: "pro", name: "Pro", monthly_tokens: 5000 };
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: sub, error: null });
    client.__tables.plans = makeChain({ data: plan, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await getCurrentPlan("u1");
    expect(result).toEqual({ plan, subscription: sub });
  });

  it("returns null if plan can't be found", async () => {
    const sub = { id: "s1", plan_key: "ghost" };
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: sub, error: null });
    client.__tables.plans = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await getCurrentPlan("u1");
    expect(result).toBeNull();
  });

  it("propagates plan-lookup errors", async () => {
    const sub = { id: "s1", plan_key: "pro" };
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: sub, error: null });
    client.__tables.plans = makeChain({ data: null, error: { message: "boom" } });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(getCurrentPlan("u1")).rejects.toEqual({ message: "boom" });
  });
});

describe("getPlanByStripePriceId / getPlanByKey", () => {
  it("queries by price id, matching either monthly or annual column", async () => {
    const client = makeClient({ plans: { data: { key: "pro" }, error: null } });
    mockedCreateAdmin.mockReturnValue(client as never);

    const plan = await getPlanByStripePriceId("price_1");
    expect(plan).toEqual({ key: "pro" });
    expect(client.__tables.plans.or).toHaveBeenCalledWith(
      "stripe_price_id.eq.price_1,stripe_annual_price_id.eq.price_1",
    );
  });

  it("queries by key", async () => {
    const client = makeClient({ plans: { data: { key: "pro" }, error: null } });
    mockedCreateAdmin.mockReturnValue(client as never);

    const plan = await getPlanByKey("pro");
    expect(plan).toEqual({ key: "pro" });
    expect(client.__tables.plans.eq).toHaveBeenCalledWith("key", "pro");
  });

  it("returns null when plan not found by price", async () => {
    const client = makeClient({ plans: { data: null, error: null } });
    mockedCreateAdmin.mockReturnValue(client as never);

    expect(await getPlanByStripePriceId("none")).toBeNull();
  });

  it("returns null when plan not found by key", async () => {
    const client = makeClient({ plans: { data: null, error: null } });
    mockedCreateAdmin.mockReturnValue(client as never);

    expect(await getPlanByKey("none")).toBeNull();
  });

  it("propagates errors from getPlanByStripePriceId", async () => {
    const client = makeClient({ plans: { data: null, error: { message: "boom" } } });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(getPlanByStripePriceId("p1")).rejects.toEqual({ message: "boom" });
  });

  it("propagates errors from getPlanByKey", async () => {
    const client = makeClient({ plans: { data: null, error: { message: "boom" } } });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(getPlanByKey("p1")).rejects.toEqual({ message: "boom" });
  });
});

const baseStripeSub = {
  id: "sub_1",
  status: "active",
  cancel_at_period_end: false,
  canceled_at: null,
  metadata: { supabase_user_id: "u1", plan_key: "pro" },
  items: {
    data: [
      {
        price: { id: "price_pro", recurring: { interval: "month" } },
        current_period_start: 1700000000,
        current_period_end: 1702592000,
      },
    ],
  },
} as unknown;

const annualStripeSub = {
  id: "sub_y",
  status: "active",
  cancel_at_period_end: false,
  canceled_at: null,
  metadata: { supabase_user_id: "u1", plan_key: "pro", interval: "year" },
  items: {
    data: [
      {
        price: { id: "price_pro_year", recurring: { interval: "year" } },
        current_period_start: 1700000000,
        current_period_end: 1731536000,
      },
    ],
  },
} as unknown;

describe("syncSubscriptionFromStripe", () => {
  it("upserts subscription using the current price id (not stale metadata)", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({ data: { key: "pro" }, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const ctx = await syncSubscriptionFromStripe({
      stripeSub: baseStripeSub as never,
    });

    expect(ctx).toEqual({ userId: "u1", planKey: "pro" });
    expect(client.__tables.subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        plan_key: "pro",
        stripe_subscription_id: "sub_1",
        stripe_price_id: "price_pro",
        status: "active",
        cancel_at_period_end: false,
      }),
      { onConflict: "stripe_subscription_id" },
    );
  });

  it("prefers the current price over stale metadata.plan_key (plan switched in dashboard)", async () => {
    // User originally subscribed to Pro (so metadata.plan_key === 'pro'),
    // then switched to Scale via the Stripe Dashboard or Customer Portal.
    // Stripe doesn't auto-update metadata, so we must trust the price.
    const switchedSub = {
      id: "sub_switched",
      status: "active",
      cancel_at_period_end: false,
      canceled_at: null,
      metadata: { supabase_user_id: "u1", plan_key: "pro" },
      items: {
        data: [
          {
            price: { id: "price_scale", recurring: { interval: "month" } },
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        ],
      },
    };

    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({ data: { key: "scale" }, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const ctx = await syncSubscriptionFromStripe({
      stripeSub: switchedSub as never,
    });

    expect(ctx).toEqual({ userId: "u1", planKey: "scale" });
    expect(client.__tables.subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_key: "scale",
        stripe_price_id: "price_scale",
      }),
      { onConflict: "stripe_subscription_id" },
    );
  });

  it("falls back to metadata.plan_key when the current price isn't a known plan", async () => {
    // Edge case: a subscription is on a custom one-off price we don't have
    // a row for. Trust the metadata pointer if present.
    const sub = {
      ...(baseStripeSub as Record<string, unknown>),
      items: {
        data: [
          {
            price: { id: "price_custom_unknown", recurring: { interval: "month" } },
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        ],
      },
    };
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const ctx = await syncSubscriptionFromStripe({ stripeSub: sub as never });
    expect(ctx).toEqual({ userId: "u1", planKey: "pro" });
  });

  it("returns null when supabase_user_id metadata is missing", async () => {
    const sub = { ...(baseStripeSub as Record<string, unknown>), metadata: {} };
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const result = await syncSubscriptionFromStripe({ stripeSub: sub as never });
    expect(result).toBeNull();
  });

  it("returns null when plan can't be resolved", async () => {
    const sub = {
      ...(baseStripeSub as Record<string, unknown>),
      metadata: { supabase_user_id: "u1" },
    };
    const client = makeClient();
    client.__tables.plans = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await syncSubscriptionFromStripe({ stripeSub: sub as never });
    expect(result).toBeNull();
  });

  it("propagates upsert errors", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({
      data: null,
      error: { message: "boom" },
    });
    client.__tables.subscriptions.upsert = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "boom" } });
    mockedCreateAdmin.mockReturnValue(client as never);

    await expect(
      syncSubscriptionFromStripe({ stripeSub: baseStripeSub as never }),
    ).rejects.toEqual({ message: "boom" });
  });

  it("returns null when stripeSub has no items", async () => {
    const sub = {
      ...(baseStripeSub as Record<string, unknown>),
      metadata: { supabase_user_id: "u1" },
      items: { data: [] },
    };
    const client = makeClient();
    client.__tables.plans = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const result = await syncSubscriptionFromStripe({ stripeSub: sub as never });
    expect(result).toBeNull();
  });

  it("flags cancel_at_period_end when stripe.cancel_at_period_end is true", async () => {
    const sub = {
      ...(baseStripeSub as Record<string, unknown>),
      cancel_at_period_end: true,
    };
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({ data: { key: "pro" }, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    await syncSubscriptionFromStripe({ stripeSub: sub as never });
    expect(client.__tables.subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ cancel_at_period_end: true }),
      expect.any(Object),
    );
  });

  it("flags cancel_at_period_end when modern Stripe sets cancel_at instead", async () => {
    // Customer Portal in Stripe API 2024-11+ schedules end-of-period
    // cancellation by setting `cancel_at` (timestamp) and leaving the legacy
    // boolean at false. We must treat that as canceling.
    const sub = {
      ...(baseStripeSub as Record<string, unknown>),
      cancel_at_period_end: false,
      cancel_at: 1780698892,
    };
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({ data: { key: "pro" }, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    await syncSubscriptionFromStripe({ stripeSub: sub as never });
    expect(client.__tables.subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ cancel_at_period_end: true }),
      expect.any(Object),
    );
  });

  it("does not flag cancel_at_period_end when neither signal is set", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({ data: { key: "pro" }, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    await syncSubscriptionFromStripe({ stripeSub: baseStripeSub as never });
    expect(client.__tables.subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ cancel_at_period_end: false }),
      expect.any(Object),
    );
  });

  it("converts canceled_at timestamps", async () => {
    const sub = {
      ...(baseStripeSub as Record<string, unknown>),
      canceled_at: 1700000500,
    };
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    await syncSubscriptionFromStripe({ stripeSub: sub as never });
    expect(client.__tables.subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        canceled_at: new Date(1700000500 * 1000).toISOString(),
      }),
      expect.any(Object),
    );
  });
});

describe("handleCheckoutCompleted", () => {
  it("syncs subscription and grants initial monthly tokens for subscription mode", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: "sub_1",
          metadata: { supabase_user_id: "u1", plan_key: "pro" },
        },
      },
    };

    const retrieve = vi.fn().mockResolvedValue(baseStripeSub as never);

    await handleCheckoutCompleted(event as never, { retrieveSubscription: retrieve });

    expect(retrieve).toHaveBeenCalledWith("sub_1");
    expect(mockedGrantTokens).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1",
      amount: 5000,
      type: "subscription_grant",
      stripeEventId: "evt_1",
    }));
  });

  it("grants 12x the monthly tokens for an annual subscription on initial checkout", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_annual",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: "sub_y",
          metadata: { supabase_user_id: "u1", plan_key: "pro", interval: "year" },
        },
      },
    };

    const retrieve = vi.fn().mockResolvedValue(annualStripeSub as never);

    await handleCheckoutCompleted(event as never, { retrieveSubscription: retrieve });

    expect(mockedGrantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 60000,
        type: "subscription_grant",
        description: expect.stringContaining("annual"),
        metadata: expect.objectContaining({ interval: "year" }),
      }),
    );
  });

  it("uses session.subscription.id when given an object", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_obj",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: { id: "sub_2" },
          metadata: { supabase_user_id: "u1", plan_key: "pro" },
        },
      },
    };
    const retrieve = vi.fn().mockResolvedValue(baseStripeSub as never);

    await handleCheckoutCompleted(event as never, { retrieveSubscription: retrieve });
    expect(retrieve).toHaveBeenCalledWith("sub_2");
  });

  it("grants top-up tokens for payment mode", async () => {
    const client = makeClient();
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_2",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_topup",
          mode: "payment",
          metadata: {
            supabase_user_id: "u1",
            pack_key: "pack_2000",
            tokens: "2000",
          },
        },
      },
    };

    await handleCheckoutCompleted(event as never);

    expect(mockedGrantTokens).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1",
      amount: 2000,
      type: "top_up_purchase",
      stripeEventId: "evt_2",
    }));
  });

  it("ignores events without supabase_user_id", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const event = {
      id: "evt_x",
      type: "checkout.session.completed",
      data: { object: { mode: "subscription", metadata: {} } },
    };
    await handleCheckoutCompleted(event as never);
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("skips subscription mode without subscription id", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const event = {
      id: "evt_y",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: null,
          metadata: { supabase_user_id: "u1" },
        },
      },
    };
    await handleCheckoutCompleted(event as never, {
      retrieveSubscription: vi.fn(),
    });
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("skips subscription mode when retrieveSubscription is not provided", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const event = {
      id: "evt_z",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: "sub_x",
          metadata: { supabase_user_id: "u1" },
        },
      },
    };
    await handleCheckoutCompleted(event as never);
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("skips subscription mode when sync returns null", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_skip",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: "sub_1",
          metadata: { supabase_user_id: "u1" },
        },
      },
    };
    await handleCheckoutCompleted(event as never, {
      retrieveSubscription: vi.fn().mockResolvedValue({
        ...(baseStripeSub as Record<string, unknown>),
        metadata: { supabase_user_id: "u1" },
      } as never),
    });
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("skips subscription mode when plan lookup returns null", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    let callCount = 0;
    client.__tables.plans = {
      ...makeChain(),
      maybeSingle: vi.fn().mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) return Promise.resolve({ data: { key: "pro" }, error: null });
        return Promise.resolve({ data: null, error: null });
      }),
    } as never;
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_no_plan",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: "sub_1",
          metadata: { supabase_user_id: "u1" },
        },
      },
    };
    await handleCheckoutCompleted(event as never, {
      retrieveSubscription: vi.fn().mockResolvedValue({
        ...(baseStripeSub as Record<string, unknown>),
        metadata: { supabase_user_id: "u1" },
      } as never),
    });
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("ignores payment mode without valid pack metadata", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const event = {
      id: "evt_invalid",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "payment",
          metadata: { supabase_user_id: "u1", pack_key: "p", tokens: "abc" },
        },
      },
    };
    await handleCheckoutCompleted(event as never);
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("ignores payment mode missing pack_key", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const event = {
      id: "evt_invalid2",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "payment",
          metadata: { supabase_user_id: "u1", tokens: "100" },
        },
      },
    };
    await handleCheckoutCompleted(event as never);
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("ignores payment mode when tokens metadata is not a string", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const event = {
      id: "evt_invalid3",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "payment",
          metadata: { supabase_user_id: "u1", pack_key: "pack_500" },
        },
      },
    };
    await handleCheckoutCompleted(event as never);
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("ignores unsupported modes", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const event = {
      id: "evt_other",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "setup",
          metadata: { supabase_user_id: "u1" },
        },
      },
    };
    await handleCheckoutCompleted(event as never);
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });
});

describe("handleCheckoutCompleted - extra coverage", () => {
  it("falls back to monthly tokens when the price has an unknown interval", async () => {
    const weeklyStripeSub = {
      ...(baseStripeSub as Record<string, unknown>),
      items: {
        data: [
          {
            price: { id: "price_pro", recurring: { interval: "week" } },
            current_period_start: 1700000000,
            current_period_end: 1700604800,
          },
        ],
      },
    };

    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_weekly",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: "sub_w",
          metadata: { supabase_user_id: "u1", plan_key: "pro" },
        },
      },
    };

    const retrieve = vi.fn().mockResolvedValue(weeklyStripeSub as never);
    await handleCheckoutCompleted(event as never, { retrieveSubscription: retrieve });

    expect(mockedGrantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5000,
        metadata: expect.objectContaining({ interval: "month" }),
      }),
    );
  });

  it("extracts latest_invoice when given as a string", async () => {
    const subWithStringInvoice = {
      ...(baseStripeSub as Record<string, unknown>),
      latest_invoice: "in_initial",
    };
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_initial_string_inv",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: "sub_1",
          metadata: { supabase_user_id: "u1", plan_key: "pro" },
        },
      },
    };
    const retrieve = vi.fn().mockResolvedValue(subWithStringInvoice as never);
    await handleCheckoutCompleted(event as never, { retrieveSubscription: retrieve });

    expect(mockedGrantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ stripe_invoice_id: "in_initial" }),
      }),
    );
  });

  it("extracts latest_invoice when given as an expanded object", async () => {
    const subWithObjectInvoice = {
      ...(baseStripeSub as Record<string, unknown>),
      latest_invoice: { id: "in_obj_initial" },
    };
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_initial_obj_inv",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: "sub_1",
          metadata: { supabase_user_id: "u1", plan_key: "pro" },
        },
      },
    };
    const retrieve = vi.fn().mockResolvedValue(subWithObjectInvoice as never);
    await handleCheckoutCompleted(event as never, { retrieveSubscription: retrieve });

    expect(mockedGrantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ stripe_invoice_id: "in_obj_initial" }),
      }),
    );
  });

  it("uses session.payment_intent (object form) on top-up grants", async () => {
    const client = makeClient();
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_topup_pi_obj",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_obj",
          mode: "payment",
          payment_intent: { id: "pi_obj" },
          metadata: {
            supabase_user_id: "u1",
            pack_key: "pack_500",
            tokens: "500",
          },
        },
      },
    };

    await handleCheckoutCompleted(event as never);

    expect(mockedGrantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ stripe_payment_intent_id: "pi_obj" }),
      }),
    );
  });

  it("uses session.payment_intent (string form) on top-up grants", async () => {
    const client = makeClient();
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_topup_pi_str",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_str",
          mode: "payment",
          payment_intent: "pi_str",
          metadata: {
            supabase_user_id: "u1",
            pack_key: "pack_500",
            tokens: "500",
          },
        },
      },
    };

    await handleCheckoutCompleted(event as never);

    expect(mockedGrantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ stripe_payment_intent_id: "pi_str" }),
      }),
    );
  });

  it("falls back to monthly tokens when the price has no recurring config", async () => {
    const noRecurringSub = {
      ...(baseStripeSub as Record<string, unknown>),
      items: {
        data: [
          {
            price: { id: "price_pro", recurring: null },
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        ],
      },
    };

    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_no_recurring",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: "sub_nr",
          metadata: { supabase_user_id: "u1", plan_key: "pro" },
        },
      },
    };

    const retrieve = vi.fn().mockResolvedValue(noRecurringSub as never);
    await handleCheckoutCompleted(event as never, { retrieveSubscription: retrieve });

    expect(mockedGrantTokens).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000 }),
    );
  });
});

describe("handleSubscriptionUpdated", () => {
  it("syncs subscription state", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({ data: { key: "pro" }, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_sync_only",
      type: "customer.subscription.updated",
      data: { object: baseStripeSub },
    };

    await handleSubscriptionUpdated(event as never);
    expect(client.__tables.subscriptions.upsert).toHaveBeenCalled();
    // No previous row → no transitions logged.
    expect(mockedRecordEvent).not.toHaveBeenCalled();
  });

  it("logs subscription_canceled when cancel_at_period_end flips false → true", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({
      data: {
        plan_key: "pro",
        cancel_at_period_end: false,
        current_period_end: "2026-06-05T00:00:00Z",
      },
      error: null,
    });
    client.__tables.plans = makeChain({ data: { key: "pro" }, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const cancelingSub = {
      ...(baseStripeSub as Record<string, unknown>),
      cancel_at_period_end: true,
    };
    const event = {
      id: "evt_cancel",
      type: "customer.subscription.updated",
      data: { object: cancelingSub },
    };

    await handleSubscriptionUpdated(event as never);

    expect(mockedRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        type: "subscription_canceled",
        stripeEventId: "evt_cancel::canceled",
        description: expect.stringContaining("Subscription scheduled to end"),
        metadata: expect.objectContaining({
          stripe_subscription_id: "sub_1",
          plan_key: "pro",
        }),
      }),
    );
  });

  it("logs subscription_canceled when modern Stripe sets cancel_at instead of the boolean", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({
      data: {
        plan_key: "pro",
        cancel_at_period_end: false,
        current_period_end: "2026-06-05T00:00:00Z",
      },
      error: null,
    });
    client.__tables.plans = makeChain({ data: { key: "pro" }, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const cancelingSub = {
      ...(baseStripeSub as Record<string, unknown>),
      cancel_at_period_end: false,
      cancel_at: 1780698892,
    };
    const event = {
      id: "evt_cancel_modern",
      type: "customer.subscription.updated",
      data: { object: cancelingSub },
    };

    await handleSubscriptionUpdated(event as never);

    expect(mockedRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "subscription_canceled",
        stripeEventId: "evt_cancel_modern::canceled",
      }),
    );
  });

  it("logs subscription_resumed when cancel_at_period_end flips true → false", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({
      data: {
        plan_key: "pro",
        cancel_at_period_end: true,
        current_period_end: "2026-06-05T00:00:00Z",
      },
      error: null,
    });
    client.__tables.plans = makeChain({ data: { key: "pro" }, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_resume",
      type: "customer.subscription.updated",
      data: { object: baseStripeSub },
    };

    await handleSubscriptionUpdated(event as never);

    expect(mockedRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "subscription_resumed",
        stripeEventId: "evt_resume::resumed",
        description: expect.stringContaining("Subscription resumed"),
      }),
    );
  });

  it("doesn't log a transition when canceling state hasn't changed", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({
      data: {
        plan_key: "pro",
        cancel_at_period_end: true,
        current_period_end: "2026-06-05T00:00:00Z",
      },
      error: null,
    });
    client.__tables.plans = makeChain({ data: { key: "pro" }, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const stillCancelingSub = {
      ...(baseStripeSub as Record<string, unknown>),
      cancel_at_period_end: true,
    };
    const event = {
      id: "evt_still_canceling",
      type: "customer.subscription.updated",
      data: { object: stillCancelingSub },
    };

    await handleSubscriptionUpdated(event as never);
    expect(mockedRecordEvent).not.toHaveBeenCalled();
  });

  it("logs plan_downgraded when the new tier has fewer monthly tokens", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({
      data: {
        plan_key: "scale",
        cancel_at_period_end: false,
        current_period_end: "2026-06-05T00:00:00Z",
      },
      error: null,
    });
    let lookups = 0;
    client.__tables.plans = {
      ...makeChain(),
      maybeSingle: vi.fn().mockImplementation(() => {
        lookups += 1;
        if (lookups === 1) {
          // resolveSubscriptionContext: lookup by current price → Pro
          return Promise.resolve({
            data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
            error: null,
          });
        }
        if (lookups === 2) {
          // recordSubscriptionTransitions: lookup of previous plan_key (scale)
          return Promise.resolve({
            data: { key: "scale", name: "Scale", monthly_tokens: 20000 },
            error: null,
          });
        }
        // recordSubscriptionTransitions: lookup of new plan_key (pro)
        return Promise.resolve({
          data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
          error: null,
        });
      }),
    } as never;
    mockedCreateAdmin.mockReturnValue(client as never);

    const downgradedSub = {
      ...(baseStripeSub as Record<string, unknown>),
      items: {
        data: [
          {
            price: { id: "price_pro", recurring: { interval: "month" } },
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        ],
      },
    };
    const event = {
      id: "evt_downgrade",
      type: "customer.subscription.updated",
      data: { object: downgradedSub },
    };

    await handleSubscriptionUpdated(event as never);

    expect(mockedRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "plan_downgraded",
        stripeEventId: "evt_downgrade::downgraded",
        description: "Plan changed from Scale to Pro",
        metadata: expect.objectContaining({
          from_plan_key: "scale",
          to_plan_key: "pro",
        }),
      }),
    );
  });

  it("uses a fallback description when no period_end is available", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({
      data: {
        plan_key: "pro",
        cancel_at_period_end: false,
        current_period_end: null,
      },
      error: null,
    });
    client.__tables.plans = makeChain({ data: { key: "pro" }, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    // current_period_end is missing on the items, so formatLongDate gives null
    // and the handler picks the period-less fallback string.
    const cancelingNoEnd = {
      ...(baseStripeSub as Record<string, unknown>),
      cancel_at_period_end: true,
      items: {
        data: [
          {
            price: { id: "price_pro", recurring: { interval: "month" } },
            current_period_start: 1700000000,
            current_period_end: null,
          },
        ],
      },
    };
    const event = {
      id: "evt_no_end",
      type: "customer.subscription.updated",
      data: { object: cancelingNoEnd },
    };

    await handleSubscriptionUpdated(event as never);

    expect(mockedRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "subscription_canceled",
        description: "Subscription scheduled for cancellation",
      }),
    );
  });

  it("uses a fallback description on resume when no period_end is available", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({
      data: {
        plan_key: "pro",
        cancel_at_period_end: true,
        current_period_end: null,
      },
      error: null,
    });
    client.__tables.plans = makeChain({ data: { key: "pro" }, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const resumingNoEnd = {
      ...(baseStripeSub as Record<string, unknown>),
      cancel_at_period_end: false,
      items: {
        data: [
          {
            price: { id: "price_pro", recurring: { interval: "month" } },
            current_period_start: 1700000000,
            current_period_end: null,
          },
        ],
      },
    };
    const event = {
      id: "evt_resume_no_end",
      type: "customer.subscription.updated",
      data: { object: resumingNoEnd },
    };

    await handleSubscriptionUpdated(event as never);

    expect(mockedRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "subscription_resumed",
        description: "Subscription resumed",
      }),
    );
  });

  it("ignores transition logging when syncSubscriptionFromStripe returns null", async () => {
    // Subscription with no metadata + no matching plan means
    // syncSubscriptionFromStripe returns null. The handler must early-return
    // and never log transitions.
    const sub = {
      ...(baseStripeSub as Record<string, unknown>),
      metadata: {},
    };
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_no_ctx",
      type: "customer.subscription.updated",
      data: { object: sub },
    };

    await handleSubscriptionUpdated(event as never);
    expect(mockedRecordEvent).not.toHaveBeenCalled();
  });

  it("does NOT log plan_downgraded on an upgrade (new tier has more tokens)", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({
      data: {
        plan_key: "pro",
        cancel_at_period_end: false,
        current_period_end: "2026-06-05T00:00:00Z",
      },
      error: null,
    });
    let lookups = 0;
    client.__tables.plans = {
      ...makeChain(),
      maybeSingle: vi.fn().mockImplementation(() => {
        lookups += 1;
        if (lookups === 1) {
          return Promise.resolve({
            data: { key: "scale", name: "Scale", monthly_tokens: 20000 },
            error: null,
          });
        }
        if (lookups === 2) {
          return Promise.resolve({
            data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
            error: null,
          });
        }
        return Promise.resolve({
          data: { key: "scale", name: "Scale", monthly_tokens: 20000 },
          error: null,
        });
      }),
    } as never;
    mockedCreateAdmin.mockReturnValue(client as never);

    const upgradedSub = {
      ...(baseStripeSub as Record<string, unknown>),
      items: {
        data: [
          {
            price: { id: "price_scale", recurring: { interval: "month" } },
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        ],
      },
    };
    const event = {
      id: "evt_upgrade_no_log",
      type: "customer.subscription.updated",
      data: { object: upgradedSub },
    };

    await handleSubscriptionUpdated(event as never);

    expect(mockedRecordEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "plan_downgraded" }),
    );
  });
});

describe("handleInvoicePaymentSucceeded", () => {
  it("grants monthly tokens on subscription_cycle", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_renew",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          billing_reason: "subscription_cycle",
          subscription: "sub_1",
        },
      },
    };

    const retrieve = vi.fn().mockResolvedValue(baseStripeSub as never);

    await handleInvoicePaymentSucceeded(event as never, { retrieveSubscription: retrieve });

    expect(mockedGrantTokens).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1",
      amount: 5000,
      type: "subscription_grant",
      stripeEventId: "evt_renew",
      description: expect.stringContaining("renewal"),
    }));
  });

  it("grants 12x monthly tokens on the annual renewal cycle", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_annual_renew",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          billing_reason: "subscription_cycle",
          subscription: "sub_y",
        },
      },
    };

    const retrieve = vi.fn().mockResolvedValue(annualStripeSub as never);

    await handleInvoicePaymentSucceeded(event as never, { retrieveSubscription: retrieve });

    expect(mockedGrantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 60000,
        description: expect.stringContaining("annual renewal"),
        metadata: expect.objectContaining({ interval: "year" }),
      }),
    );
  });

  it("uses subscription.id when given an object", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_renew2",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          billing_reason: "subscription_cycle",
          subscription: { id: "sub_obj" },
        },
      },
    };
    const retrieve = vi.fn().mockResolvedValue(baseStripeSub as never);

    await handleInvoicePaymentSucceeded(event as never, { retrieveSubscription: retrieve });
    expect(retrieve).toHaveBeenCalledWith("sub_obj");
  });

  it("skips when billing_reason is unrelated (subscription_create / manual / threshold)", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    for (const reason of ["subscription_create", "manual", "subscription_threshold"]) {
      const event = {
        id: `evt_${reason}`,
        type: "invoice.payment_succeeded",
        data: {
          object: { billing_reason: reason, subscription: "sub_1" },
        },
      };
      await handleInvoicePaymentSucceeded(event as never, {
        retrieveSubscription: vi.fn(),
      });
    }
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("skips when subscription id is missing", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const event = {
      id: "evt_nosub",
      type: "invoice.payment_succeeded",
      data: { object: { billing_reason: "subscription_cycle", subscription: null } },
    };
    await handleInvoicePaymentSucceeded(event as never, {
      retrieveSubscription: vi.fn(),
    });
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("skips when sync returns null (e.g. missing metadata)", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_metaless",
      type: "invoice.payment_succeeded",
      data: { object: { billing_reason: "subscription_cycle", subscription: "sub_1" } },
    };
    await handleInvoicePaymentSucceeded(event as never, {
      retrieveSubscription: vi.fn().mockResolvedValue({
        ...(baseStripeSub as Record<string, unknown>),
        metadata: {},
      } as never),
    });
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("skips when retrieveSubscription is not provided", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const event = {
      id: "evt_no_retrieve",
      type: "invoice.payment_succeeded",
      data: { object: { billing_reason: "subscription_cycle", subscription: "sub_1" } },
    };
    await handleInvoicePaymentSucceeded(event as never);
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("skips when plan lookup returns null", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    let callCount = 0;
    client.__tables.plans = {
      ...makeChain(),
      maybeSingle: vi.fn().mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) return Promise.resolve({ data: { key: "pro" }, error: null });
        return Promise.resolve({ data: null, error: null });
      }),
    } as never;
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_no_plan",
      type: "invoice.payment_succeeded",
      data: { object: { billing_reason: "subscription_cycle", subscription: "sub_1" } },
    };
    await handleInvoicePaymentSucceeded(event as never, {
      retrieveSubscription: vi.fn().mockResolvedValue({
        ...(baseStripeSub as Record<string, unknown>),
        metadata: { supabase_user_id: "u1" },
      } as never),
    });
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("grants the token delta on an upgrade (subscription_update)", async () => {
    // Pro→Scale mid-cycle: previous grant was 5,000 (Pro monthly), new tier
    // is 20,000 (Scale monthly). Should grant 15,000.
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    let planLookups = 0;
    client.__tables.plans = {
      ...makeChain(),
      maybeSingle: vi.fn().mockImplementation(() => {
        planLookups += 1;
        return Promise.resolve({
          data: { key: "scale", name: "Scale", monthly_tokens: 20000 },
          error: null,
        });
      }),
    } as never;
    client.__tables.token_transactions = makeChain({
      data: { amount: 5000, metadata: { plan_key: "pro" } },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_upgrade",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_upgrade_proration",
          billing_reason: "subscription_update",
          subscription: "sub_1",
        },
      },
    };

    const upgradedSub = {
      ...(baseStripeSub as Record<string, unknown>),
      items: {
        data: [
          {
            price: { id: "price_scale", recurring: { interval: "month" } },
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        ],
      },
    };
    const retrieve = vi.fn().mockResolvedValue(upgradedSub as never);

    await handleInvoicePaymentSucceeded(event as never, { retrieveSubscription: retrieve });

    expect(planLookups).toBeGreaterThan(0);
    expect(mockedGrantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        amount: 15000,
        type: "subscription_grant",
        description: expect.stringContaining("Upgraded to Scale"),
        stripeEventId: "evt_upgrade",
        metadata: expect.objectContaining({
          grant_kind: "upgrade_proration",
          previous_plan_key: "pro",
          previous_cycle_tokens: 5000,
          new_cycle_tokens: 20000,
        }),
      }),
    );
  });

  it("scales the upgrade delta correctly for an annual subscription", async () => {
    // Annual Pro (60,000 prior grant) → Annual Scale (240,000). Delta = 180,000.
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = {
      ...makeChain(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { key: "scale", name: "Scale", monthly_tokens: 20000 },
        error: null,
      }),
    } as never;
    client.__tables.token_transactions = makeChain({
      data: { amount: 60000, metadata: { plan_key: "pro" } },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_upgrade_annual",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_annual_upgrade",
          billing_reason: "subscription_update",
          subscription: "sub_y",
        },
      },
    };

    const annualScaleSub = {
      ...(annualStripeSub as Record<string, unknown>),
      items: {
        data: [
          {
            price: { id: "price_scale_year", recurring: { interval: "year" } },
            current_period_start: 1700000000,
            current_period_end: 1731536000,
          },
        ],
      },
    };
    const retrieve = vi.fn().mockResolvedValue(annualScaleSub as never);

    await handleInvoicePaymentSucceeded(event as never, { retrieveSubscription: retrieve });

    expect(mockedGrantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 180000,
        metadata: expect.objectContaining({
          interval: "year",
          previous_cycle_tokens: 60000,
          new_cycle_tokens: 240000,
        }),
      }),
    );
  });

  it("skips the grant on a downgrade (subscription_update with negative delta)", async () => {
    // Scale → Pro mid-cycle: previous grant 20,000, new tier 5,000. No grant.
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: { amount: 20000, metadata: { plan_key: "scale" } },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_downgrade",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_downgrade",
          billing_reason: "subscription_update",
          subscription: "sub_1",
        },
      },
    };
    const retrieve = vi.fn().mockResolvedValue(baseStripeSub as never);

    await handleInvoicePaymentSucceeded(event as never, { retrieveSubscription: retrieve });
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("skips when the upgrade delta is zero (same-tier proration)", async () => {
    // No-op switch (e.g. price update with same monthly_tokens). Skip grant.
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: { amount: 5000, metadata: { plan_key: "pro" } },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_same_tier",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_same",
          billing_reason: "subscription_update",
          subscription: "sub_1",
        },
      },
    };
    const retrieve = vi.fn().mockResolvedValue(baseStripeSub as never);

    await handleInvoicePaymentSucceeded(event as never, { retrieveSubscription: retrieve });
    expect(mockedGrantTokens).not.toHaveBeenCalled();
  });

  it("treats a missing previous grant as zero on subscription_update", async () => {
    // Edge case: subscription_update fires without a prior grant on this sub
    // (rare; e.g. the initial grant came from checkout.session.completed and
    // metadata search returned nothing). Treat the previous baseline as zero.
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    client.__tables.token_transactions = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_no_prior",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_first",
          billing_reason: "subscription_update",
          subscription: "sub_1",
        },
      },
    };
    const retrieve = vi.fn().mockResolvedValue(baseStripeSub as never);

    await handleInvoicePaymentSucceeded(event as never, { retrieveSubscription: retrieve });
    expect(mockedGrantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5000,
        metadata: expect.objectContaining({
          previous_plan_key: null,
          previous_cycle_tokens: 0,
        }),
      }),
    );
  });

  it("propagates errors from the previous-grant lookup", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: null,
      error: { message: "lookup failed" },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_err_prev",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_err",
          billing_reason: "subscription_update",
          subscription: "sub_1",
        },
      },
    };
    const retrieve = vi.fn().mockResolvedValue(baseStripeSub as never);

    await expect(
      handleInvoicePaymentSucceeded(event as never, { retrieveSubscription: retrieve }),
    ).rejects.toEqual({ message: "lookup failed" });
  });

  it("reads subscription id from invoice.parent when given as an expanded object", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_modern_obj",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_modern_obj",
          billing_reason: "subscription_cycle",
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: { id: "sub_obj_modern" } },
          },
        },
      },
    };

    const retrieve = vi.fn().mockResolvedValue(baseStripeSub as never);
    await handleInvoicePaymentSucceeded(event as never, {
      retrieveSubscription: retrieve,
    });

    expect(retrieve).toHaveBeenCalledWith("sub_obj_modern");
  });

  it("treats a previous grant with null/sparse metadata as zero baseline", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    // Most recent grant has metadata=null and amount=null — exercises both
    // `(metadata ?? {})` and `typeof amount === "number"` fallbacks.
    client.__tables.token_transactions = makeChain({
      data: { amount: null, metadata: null },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_sparse_prev",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_sparse",
          billing_reason: "subscription_update",
          subscription: "sub_1",
        },
      },
    };
    const retrieve = vi.fn().mockResolvedValue(baseStripeSub as never);

    await handleInvoicePaymentSucceeded(event as never, { retrieveSubscription: retrieve });

    expect(mockedGrantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5000,
        metadata: expect.objectContaining({
          previous_plan_key: null,
          previous_cycle_tokens: 0,
        }),
      }),
    );
  });

  it("uses interval='month' on a subscription_update with no recurring config", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    client.__tables.token_transactions = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const noRecurringSub = {
      ...(baseStripeSub as Record<string, unknown>),
      items: {
        data: [
          {
            price: { id: "price_pro", recurring: null },
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        ],
      },
    };

    const event = {
      id: "evt_upgrade_no_recurring",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_no_recurring",
          billing_reason: "subscription_update",
          subscription: "sub_1",
        },
      },
    };
    const retrieve = vi.fn().mockResolvedValue(noRecurringSub as never);

    await handleInvoicePaymentSucceeded(event as never, { retrieveSubscription: retrieve });

    expect(mockedGrantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ interval: "month" }),
      }),
    );
  });

  it("reads subscription id from invoice.parent.subscription_details (Stripe API 2024-11+)", async () => {
    // Modern Stripe API moved `invoice.subscription` into
    // `invoice.parent.subscription_details.subscription`. The handler must
    // pick it up from there, not from the (now-undefined) legacy field.
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_modern_api",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_modern",
          billing_reason: "subscription_cycle",
          // legacy field absent in modern API
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: "sub_modern" },
          },
        },
      },
    };

    const retrieve = vi.fn().mockResolvedValue(baseStripeSub as never);
    await handleInvoicePaymentSucceeded(event as never, {
      retrieveSubscription: retrieve,
    });

    expect(retrieve).toHaveBeenCalledWith("sub_modern");
    expect(mockedGrantTokens).toHaveBeenCalled();
  });

  it("falls back to interval='month' on a renewal when recurring is missing", async () => {
    const noRecurringSub = {
      ...(baseStripeSub as Record<string, unknown>),
      items: {
        data: [
          {
            price: { id: "price_pro", recurring: null },
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        ],
      },
    };

    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_renew_no_recurring",
      type: "invoice.payment_succeeded",
      data: {
        object: { billing_reason: "subscription_cycle", subscription: "sub_nr_renew", id: "in_nr" },
      },
    };

    const retrieve = vi.fn().mockResolvedValue(noRecurringSub as never);
    await handleInvoicePaymentSucceeded(event as never, { retrieveSubscription: retrieve });

    expect(mockedGrantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5000,
        metadata: expect.objectContaining({ interval: "month" }),
      }),
    );
  });
});

describe("handleInvoicePaymentFailed", () => {
  it("marks subscription past_due", async () => {
    const update = vi.fn().mockReturnThis();
    const eq = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      from: vi.fn().mockReturnValue({ update, eq }),
    } as unknown as MockClient;
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_fail",
      type: "invoice.payment_failed",
      data: { object: { subscription: "sub_1" } },
    };

    await handleInvoicePaymentFailed(event as never);

    expect(update).toHaveBeenCalledWith({ status: "past_due" });
    expect(eq).toHaveBeenCalledWith("stripe_subscription_id", "sub_1");
  });

  it("supports subscription as object", async () => {
    const update = vi.fn().mockReturnThis();
    const eq = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      from: vi.fn().mockReturnValue({ update, eq }),
    } as unknown as MockClient;
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_fail_obj",
      type: "invoice.payment_failed",
      data: { object: { subscription: { id: "sub_obj" } } },
    };

    await handleInvoicePaymentFailed(event as never);
    expect(eq).toHaveBeenCalledWith("stripe_subscription_id", "sub_obj");
  });

  it("reads subscription id from invoice.parent on modern Stripe APIs", async () => {
    const update = vi.fn().mockReturnThis();
    const eq = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      from: vi.fn().mockReturnValue({ update, eq }),
    } as unknown as MockClient;
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_fail_modern",
      type: "invoice.payment_failed",
      data: {
        object: {
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: "sub_modern" },
          },
        },
      },
    };

    await handleInvoicePaymentFailed(event as never);
    expect(eq).toHaveBeenCalledWith("stripe_subscription_id", "sub_modern");
  });

  it("does nothing when subscription is missing", async () => {
    const update = vi.fn();
    const client = { from: vi.fn().mockReturnValue({ update }) } as unknown as MockClient;
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_fail_nosub",
      type: "invoice.payment_failed",
      data: { object: { subscription: null } },
    };

    await handleInvoicePaymentFailed(event as never);
    expect(update).not.toHaveBeenCalled();
  });

  it("propagates errors", async () => {
    const update = vi.fn().mockReturnThis();
    const eq = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    const client = {
      from: vi.fn().mockReturnValue({ update, eq }),
    } as unknown as MockClient;
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_fail_err",
      type: "invoice.payment_failed",
      data: { object: { subscription: "sub_1" } },
    };
    await expect(handleInvoicePaymentFailed(event as never)).rejects.toEqual({ message: "boom" });
  });
});

describe("handleChargeRefunded", () => {
  it("revokes proportional tokens for a subscription invoice refund", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: [{ amount: 5000 }],
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedRecordRefund.mockResolvedValue({ requested: 5000, deducted: 5000, balance: 100 });

    const event = {
      id: "evt_refund_full",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_1",
          customer: "cus_1",
          invoice: "in_1",
          payment_intent: "pi_1",
          amount: 7900,
          amount_refunded: 7900,
        },
      },
    };

    await handleChargeRefunded(event as never);

    expect(client.__tables.stripe_customers.eq).toHaveBeenCalledWith(
      "stripe_customer_id",
      "cus_1",
    );
    expect(client.__tables.token_transactions.filter).toHaveBeenCalledWith(
      "metadata->>stripe_invoice_id",
      "eq",
      "in_1",
    );
    expect(mockedRecordRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        amount: 5000,
        stripeEventId: "evt_refund_full",
        metadata: expect.objectContaining({
          stripe_charge_id: "ch_1",
          stripe_invoice_id: "in_1",
          total_granted: 5000,
          amount_refunded_cents: 7900,
        }),
      }),
    );
  });

  it("scales the revocation when the refund is partial", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: [{ amount: 5000 }],
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedRecordRefund.mockResolvedValue({ requested: 1000, deducted: 1000, balance: 100 });

    const event = {
      id: "evt_refund_partial",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_partial",
          customer: "cus_1",
          invoice: "in_1",
          amount: 7900,
          amount_refunded: 1580,
        },
      },
    };

    await handleChargeRefunded(event as never);

    expect(mockedRecordRefund).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000 }),
    );
  });

  it("uses payment_intent metadata when invoice is missing (top-ups)", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: [{ amount: 2000 }],
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedRecordRefund.mockResolvedValue({ requested: 2000, deducted: 2000, balance: 0 });

    const event = {
      id: "evt_refund_topup",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_t",
          customer: "cus_1",
          invoice: null,
          payment_intent: "pi_42",
          amount: 1000,
          amount_refunded: 1000,
        },
      },
    };

    await handleChargeRefunded(event as never);

    expect(client.__tables.token_transactions.filter).toHaveBeenCalledWith(
      "metadata->>stripe_payment_intent_id",
      "eq",
      "pi_42",
    );
    expect(mockedRecordRefund).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000 }),
    );
  });

  it("does nothing when the customer can't be linked to a user", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_no_user",
      type: "charge.refunded",
      data: {
        object: { id: "ch_x", customer: "cus_unknown", amount: 100, amount_refunded: 100 },
      },
    };

    await handleChargeRefunded(event as never);
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });

  it("does nothing when no grants are found for the charge", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({ data: [], error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_no_grants",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_x",
          customer: "cus_1",
          invoice: "in_x",
          amount: 100,
          amount_refunded: 100,
        },
      },
    };

    await handleChargeRefunded(event as never);
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });

  it("ignores events without a customer", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);

    const event = {
      id: "evt_nocust",
      type: "charge.refunded",
      data: { object: { id: "ch_n", customer: null, amount: 100, amount_refunded: 100 } },
    };

    await handleChargeRefunded(event as never);
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });
});

describe("handleChargeRefunded - extra coverage", () => {
  it("does nothing when the charge has neither invoice nor payment_intent", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_no_link",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_orphan",
          customer: "cus_1",
          invoice: null,
          payment_intent: null,
          amount: 1000,
          amount_refunded: 1000,
        },
      },
    };

    await handleChargeRefunded(event as never);
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });

  it("treats missing amount fields as zero (and short-circuits)", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: [{ amount: 1000 }],
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_missing_amounts",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_zero",
          customer: "cus_1",
          invoice: "in_x",
          // amount and amount_refunded omitted entirely
        },
      },
    };

    await handleChargeRefunded(event as never);
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });

  it("propagates errors from the customer lookup", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: null,
      error: { message: "lookup failed" },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_err_cust",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_err",
          customer: "cus_1",
          invoice: "in_e",
          amount: 100,
          amount_refunded: 100,
        },
      },
    };

    await expect(handleChargeRefunded(event as never)).rejects.toEqual({
      message: "lookup failed",
    });
  });

  it("propagates errors from the grants sum", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: null,
      error: { message: "sum failed" },
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_err_sum",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_err_sum",
          customer: "cus_1",
          invoice: "in_x",
          amount: 100,
          amount_refunded: 100,
        },
      },
    };

    await expect(handleChargeRefunded(event as never)).rejects.toEqual({
      message: "sum failed",
    });
  });

  it("treats null sum data and null amount rows as zero", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      // null data simulates a rare PostgREST result with no rows; one row with
      // a null amount exercises the `(row.amount ?? 0)` fallback.
      data: [{ amount: null }],
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_null_data",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_null",
          customer: "cus_1",
          invoice: "in_null",
          amount: 100,
          amount_refunded: 100,
        },
      },
    };

    await handleChargeRefunded(event as never);
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });

  it("treats a null filter() data response as an empty grant set", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_null_filter",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_nf",
          customer: "cus_1",
          invoice: "in_nf",
          amount: 100,
          amount_refunded: 100,
        },
      },
    };

    await handleChargeRefunded(event as never);
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });

  it("does nothing when amount_refunded is zero (revoke calculates to zero)", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: [{ amount: 5000 }],
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_zero_refund",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_zero",
          customer: "cus_1",
          invoice: "in_1",
          amount: 7900,
          amount_refunded: 0,
        },
      },
    };

    await handleChargeRefunded(event as never);
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });

  it("handles charge.invoice given as an expanded object", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: [{ amount: 5000 }],
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedRecordRefund.mockResolvedValue({ requested: 5000, deducted: 5000, balance: 0 });

    const event = {
      id: "evt_obj_invoice",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_obj",
          customer: "cus_1",
          invoice: { id: "in_obj" },
          amount: 7900,
          amount_refunded: 7900,
        },
      },
    };

    await handleChargeRefunded(event as never);
    expect(client.__tables.token_transactions.filter).toHaveBeenCalledWith(
      "metadata->>stripe_invoice_id",
      "eq",
      "in_obj",
    );
  });

  it("handles customer given as an expanded object", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({ data: [], error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_cust_obj",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_co",
          customer: { id: "cus_1" },
          invoice: "in_x",
          amount: 100,
          amount_refunded: 100,
        },
      },
    };

    await handleChargeRefunded(event as never);
    expect(client.__tables.stripe_customers.eq).toHaveBeenCalledWith(
      "stripe_customer_id",
      "cus_1",
    );
  });
});

describe("handleChargeDisputeClosed", () => {
  it("revokes the full grant when a dispute is lost", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: [{ amount: 5000 }],
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedRecordRefund.mockResolvedValue({ requested: 5000, deducted: 5000, balance: 0 });

    const retrieveCharge = vi.fn().mockResolvedValue({
      id: "ch_1",
      customer: "cus_1",
      invoice: "in_1",
    });

    const event = {
      id: "evt_dispute_lost",
      type: "charge.dispute.closed",
      data: {
        object: {
          id: "dp_1",
          status: "lost",
          charge: "ch_1",
        },
      },
    };

    await handleChargeDisputeClosed(event as never, { retrieveCharge });

    expect(retrieveCharge).toHaveBeenCalledWith("ch_1");
    expect(mockedRecordRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        amount: 5000,
        stripeEventId: "evt_dispute_lost",
        metadata: expect.objectContaining({
          stripe_dispute_id: "dp_1",
          dispute_status: "lost",
        }),
      }),
    );
  });

  it("does nothing when the dispute is won", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const retrieveCharge = vi.fn();

    const event = {
      id: "evt_dispute_won",
      type: "charge.dispute.closed",
      data: {
        object: { id: "dp_2", status: "won", charge: "ch_2" },
      },
    };

    await handleChargeDisputeClosed(event as never, { retrieveCharge });

    expect(retrieveCharge).not.toHaveBeenCalled();
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });

  it("does nothing when retrieveCharge isn't provided", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);

    const event = {
      id: "evt_dispute_norpc",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_3", status: "lost", charge: "ch_3" } },
    };

    await handleChargeDisputeClosed(event as never);
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });

  it("does nothing when the dispute has no charge id", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const retrieveCharge = vi.fn();

    const event = {
      id: "evt_dispute_nocharge",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_x", status: "lost", charge: null } },
    };

    await handleChargeDisputeClosed(event as never, { retrieveCharge });
    expect(retrieveCharge).not.toHaveBeenCalled();
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });

  it("does nothing when the underlying charge has no customer", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const retrieveCharge = vi.fn().mockResolvedValue({
      id: "ch_orphan",
      customer: null,
      invoice: "in_orphan",
    });

    const event = {
      id: "evt_dispute_orphan",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_orphan", status: "lost", charge: "ch_orphan" } },
    };

    await handleChargeDisputeClosed(event as never, { retrieveCharge });
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });

  it("does nothing when the customer can't be linked to a user", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);
    const retrieveCharge = vi.fn().mockResolvedValue({
      id: "ch_unlinked",
      customer: "cus_unlinked",
      invoice: "in_unlinked",
    });

    const event = {
      id: "evt_dispute_unlinked",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_unlinked", status: "lost", charge: "ch_unlinked" } },
    };

    await handleChargeDisputeClosed(event as never, { retrieveCharge });
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });

  it("falls back to payment_intent linkage when the dispute has no invoice", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: [{ amount: 2000 }],
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedRecordRefund.mockResolvedValue({ requested: 2000, deducted: 2000, balance: 0 });

    const retrieveCharge = vi.fn().mockResolvedValue({
      id: "ch_topup",
      customer: "cus_1",
      invoice: null,
      payment_intent: "pi_topup",
    });

    const event = {
      id: "evt_dispute_pi",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_pi", status: "lost", charge: "ch_topup" } },
    };

    await handleChargeDisputeClosed(event as never, { retrieveCharge });

    expect(client.__tables.token_transactions.filter).toHaveBeenCalledWith(
      "metadata->>stripe_payment_intent_id",
      "eq",
      "pi_topup",
    );
    expect(mockedRecordRefund).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000 }),
    );
  });

  it("does nothing when no grants are linked to the disputed charge", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({ data: [], error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const retrieveCharge = vi.fn().mockResolvedValue({
      id: "ch_empty",
      customer: "cus_1",
      invoice: "in_empty",
    });

    const event = {
      id: "evt_dispute_empty",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_empty", status: "lost", charge: "ch_empty" } },
    };

    await handleChargeDisputeClosed(event as never, { retrieveCharge });
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });

  it("does nothing when the charge has neither invoice nor payment_intent", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const retrieveCharge = vi.fn().mockResolvedValue({
      id: "ch_unlinked",
      customer: "cus_1",
      invoice: null,
      payment_intent: null,
    });

    const event = {
      id: "evt_dispute_no_link",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_no_link", status: "lost", charge: "ch_unlinked" } },
    };

    await handleChargeDisputeClosed(event as never, { retrieveCharge });
    expect(mockedRecordRefund).not.toHaveBeenCalled();
  });

  it("handles dispute.charge given as an expanded object", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: [{ amount: 1000 }],
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedRecordRefund.mockResolvedValue({ requested: 1000, deducted: 1000, balance: 0 });

    const retrieveCharge = vi.fn().mockResolvedValue({
      id: "ch_obj_dispute",
      customer: { id: "cus_1" },
      invoice: { id: "in_obj_dispute" },
    });

    const event = {
      id: "evt_dispute_full_obj",
      type: "charge.dispute.closed",
      data: {
        object: {
          id: "dp_obj",
          status: "lost",
          charge: { id: "ch_obj_dispute" },
        },
      },
    };

    await handleChargeDisputeClosed(event as never, { retrieveCharge });
    expect(retrieveCharge).toHaveBeenCalledWith("ch_obj_dispute");
    expect(mockedRecordRefund).toHaveBeenCalled();
  });
});

describe("handleWebhookEvent", () => {
  it("dispatches checkout.session.completed", async () => {
    const client = makeClient();
    mockedCreateAdmin.mockReturnValue(client as never);
    const event = {
      id: "evt_dispatch",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "payment",
          metadata: {
            supabase_user_id: "u1",
            pack_key: "pack_500",
            tokens: "500",
          },
        },
      },
    };
    await handleWebhookEvent(event as never);
    expect(mockedGrantTokens).toHaveBeenCalled();
  });

  it("dispatches customer.subscription.created/updated/deleted to handleSubscriptionUpdated", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    for (const type of [
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ]) {
      const event = { id: "evt", type, data: { object: baseStripeSub } };
      await handleWebhookEvent(event as never);
    }
    expect(client.__tables.subscriptions.upsert).toHaveBeenCalledTimes(3);
  });

  it("dispatches invoice.payment_succeeded", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({
      data: { key: "pro", name: "Pro", monthly_tokens: 5000 },
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_inv_succ",
      type: "invoice.payment_succeeded",
      data: { object: { billing_reason: "subscription_cycle", subscription: "sub_1" } },
    };
    const retrieve = vi.fn().mockResolvedValue(baseStripeSub as never);
    await handleWebhookEvent(event as never, { retrieveSubscription: retrieve });
    expect(mockedGrantTokens).toHaveBeenCalled();
  });

  it("dispatches invoice.payment_failed", async () => {
    const update = vi.fn().mockReturnThis();
    const eq = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      from: vi.fn().mockReturnValue({ update, eq }),
    } as unknown as MockClient;
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      id: "evt_inv_fail",
      type: "invoice.payment_failed",
      data: { object: { subscription: "sub_1" } },
    };
    await handleWebhookEvent(event as never);
    expect(update).toHaveBeenCalledWith({ status: "past_due" });
  });

  it("dispatches charge.refunded", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: [{ amount: 1000 }],
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedRecordRefund.mockResolvedValue({ requested: 1000, deducted: 1000, balance: 0 });

    const event = {
      id: "evt_refund_dispatch",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_d",
          customer: "cus_1",
          invoice: "in_d",
          amount: 1000,
          amount_refunded: 1000,
        },
      },
    };

    await handleWebhookEvent(event as never);
    expect(mockedRecordRefund).toHaveBeenCalled();
  });

  it("dispatches charge.dispute.closed (lost)", async () => {
    const client = makeClient();
    client.__tables.stripe_customers = makeChain({
      data: { user_id: "u1" },
      error: null,
    });
    client.__tables.token_transactions = makeChain({
      data: [{ amount: 1000 }],
      error: null,
    });
    mockedCreateAdmin.mockReturnValue(client as never);
    mockedRecordRefund.mockResolvedValue({ requested: 1000, deducted: 1000, balance: 0 });

    const retrieveCharge = vi.fn().mockResolvedValue({
      id: "ch_lost",
      customer: "cus_1",
      invoice: "in_lost",
    });

    const event = {
      id: "evt_dispute_dispatch",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_lost", status: "lost", charge: "ch_lost" } },
    };

    await handleWebhookEvent(event as never, { retrieveCharge });
    expect(mockedRecordRefund).toHaveBeenCalled();
  });

  it("ignores unknown event types", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const event = { id: "evt_x", type: "some.other.type", data: { object: {} } };
    await expect(handleWebhookEvent(event as never)).resolves.toBeUndefined();
  });
});
