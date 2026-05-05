import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("./stripe-service", () => ({
  findOrCreateCustomer: vi.fn(),
}));

vi.mock("./token-service", () => ({
  grantTokens: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { findOrCreateCustomer } from "./stripe-service";
import { grantTokens } from "./token-service";
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
  handleWebhookEvent,
} from "./billing-service";

const mockedCreateAdmin = vi.mocked(createAdminClient);
const mockedFindOrCreate = vi.mocked(findOrCreateCustomer);
const mockedGrantTokens = vi.mocked(grantTokens);

type ChainResult<T> = { data: T; error: { code?: string; message?: string } | null };

function makeChain(initial: ChainResult<unknown> = { data: null, error: null }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue(initial),
    upsert: vi.fn().mockResolvedValue(initial),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(initial),
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
  it("queries by price id", async () => {
    const client = makeClient({ plans: { data: { key: "pro" }, error: null } });
    mockedCreateAdmin.mockReturnValue(client as never);

    const plan = await getPlanByStripePriceId("price_1");
    expect(plan).toEqual({ key: "pro" });
    expect(client.__tables.plans.eq).toHaveBeenCalledWith("stripe_price_id", "price_1");
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
        price: { id: "price_pro" },
        current_period_start: 1700000000,
        current_period_end: 1702592000,
      },
    ],
  },
} as unknown;

describe("syncSubscriptionFromStripe", () => {
  it("upserts subscription using metadata for context", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
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

  it("falls back to plan lookup by price id when metadata.plan_key absent", async () => {
    const sub = {
      ...(baseStripeSub as Record<string, unknown>),
      metadata: { supabase_user_id: "u1" },
    };
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    client.__tables.plans = makeChain({ data: { key: "starter" }, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const ctx = await syncSubscriptionFromStripe({ stripeSub: sub as never });
    expect(ctx).toEqual({ userId: "u1", planKey: "starter" });
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

describe("handleSubscriptionUpdated", () => {
  it("syncs subscription state", async () => {
    const client = makeClient();
    client.__tables.subscriptions = makeChain({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(client as never);

    const event = {
      type: "customer.subscription.updated",
      data: { object: baseStripeSub },
    };

    await handleSubscriptionUpdated(event as never);
    expect(client.__tables.subscriptions.upsert).toHaveBeenCalled();
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

  it("skips when billing_reason is not subscription_cycle (e.g. initial create)", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const event = {
      id: "evt_create",
      type: "invoice.payment_succeeded",
      data: {
        object: { billing_reason: "subscription_create", subscription: "sub_1" },
      },
    };
    await handleInvoicePaymentSucceeded(event as never, {
      retrieveSubscription: vi.fn(),
    });
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

  it("ignores unknown event types", async () => {
    mockedCreateAdmin.mockReturnValue(makeClient() as never);
    const event = { id: "evt_x", type: "some.other.type", data: { object: {} } };
    await expect(handleWebhookEvent(event as never)).resolves.toBeUndefined();
  });
});
