import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const {
  mockSessionsCreate,
  mockSessionsRetrieve,
  mockCustomersCreate,
  mockPortalCreate,
  mockConstructEventAsync,
  StripeMock,
} = vi.hoisted(() => {
  const mockSessionsCreate = vi.fn();
  const mockSessionsRetrieve = vi.fn();
  const mockCustomersCreate = vi.fn();
  const mockPortalCreate = vi.fn();
  const mockConstructEventAsync = vi.fn();
  const StripeMock = vi.fn(function StripeMock() {
    return {
      checkout: {
        sessions: {
          create: mockSessionsCreate,
          retrieve: mockSessionsRetrieve,
        },
      },
      customers: {
        create: mockCustomersCreate,
      },
      billingPortal: {
        sessions: {
          create: mockPortalCreate,
        },
      },
      webhooks: {
        constructEventAsync: mockConstructEventAsync,
      },
    };
  });
  return {
    mockSessionsCreate,
    mockSessionsRetrieve,
    mockCustomersCreate,
    mockPortalCreate,
    mockConstructEventAsync,
    StripeMock,
  };
});

vi.mock("stripe", () => ({ default: StripeMock }));

import {
  getStripe,
  resetStripeForTesting,
  findOrCreateCustomer,
  createSubscriptionCheckoutSession,
  createTopUpCheckoutSession,
  createPortalSession,
  retrieveCheckoutSession,
  verifyWebhook,
} from "./stripe-service";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  resetStripeForTesting();
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("getStripe", () => {
  it("constructs a Stripe singleton with the secret key", () => {
    const a = getStripe();
    const b = getStripe();
    expect(a).toBe(b);
    expect(StripeMock).toHaveBeenCalledTimes(1);
    expect(StripeMock).toHaveBeenCalledWith("sk_test_x", { typescript: true });
  });

  it("throws when STRIPE_SECRET_KEY is missing", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => getStripe()).toThrow(/Missing STRIPE_SECRET_KEY/);
  });
});

describe("findOrCreateCustomer", () => {
  it("returns the existing customer id without calling Stripe", async () => {
    const id = await findOrCreateCustomer({
      email: "u@test.com",
      userId: "user-1",
      existingCustomerId: "cus_123",
    });
    expect(id).toBe("cus_123");
    expect(mockCustomersCreate).not.toHaveBeenCalled();
  });

  it("creates a new customer when none exists", async () => {
    mockCustomersCreate.mockResolvedValue({ id: "cus_new" });
    const id = await findOrCreateCustomer({ email: "u@test.com", userId: "user-1" });
    expect(id).toBe("cus_new");
    expect(mockCustomersCreate).toHaveBeenCalledWith({
      email: "u@test.com",
      metadata: { supabase_user_id: "user-1" },
    });
  });
});

describe("createSubscriptionCheckoutSession", () => {
  it("creates an embedded subscription checkout session", async () => {
    mockSessionsCreate.mockResolvedValue({ id: "cs_1", client_secret: "secret_1" });

    const result = await createSubscriptionCheckoutSession({
      customerId: "cus_1",
      priceId: "price_1",
      userId: "user-1",
      planKey: "pro",
    });

    expect(result).toEqual({ id: "cs_1", clientSecret: "secret_1" });
    expect(mockSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      mode: "subscription",
      ui_mode: "embedded_page",
      customer: "cus_1",
      line_items: [{ price: "price_1", quantity: 1 }],
      return_url: "https://app.test/checkout/return?session_id={CHECKOUT_SESSION_ID}",
      metadata: expect.objectContaining({
        supabase_user_id: "user-1",
        plan_key: "pro",
        checkout_kind: "subscription",
      }),
    }));
  });

  it("throws when Stripe omits client_secret", async () => {
    mockSessionsCreate.mockResolvedValue({ id: "cs_x", client_secret: null });
    await expect(
      createSubscriptionCheckoutSession({
        customerId: "cus_1",
        priceId: "price_1",
        userId: "user-1",
        planKey: "pro",
      }),
    ).rejects.toThrow(/client_secret/);
  });

  it("uses the default app url when NEXT_PUBLIC_APP_URL is not set", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    mockSessionsCreate.mockResolvedValue({ id: "cs_2", client_secret: "secret_2" });

    await createSubscriptionCheckoutSession({
      customerId: "cus_1",
      priceId: "price_1",
      userId: "user-1",
      planKey: "pro",
    });

    expect(mockSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      return_url: "http://localhost:3000/checkout/return?session_id={CHECKOUT_SESSION_ID}",
    }));
  });

  it("respects a custom returnPath", async () => {
    mockSessionsCreate.mockResolvedValue({ id: "cs_3", client_secret: "secret_3" });
    await createSubscriptionCheckoutSession({
      customerId: "cus_1",
      priceId: "price_1",
      userId: "user-1",
      planKey: "pro",
      returnPath: "/custom?session_id={CHECKOUT_SESSION_ID}",
    });
    expect(mockSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      return_url: "https://app.test/custom?session_id={CHECKOUT_SESSION_ID}",
    }));
  });
});

describe("createTopUpCheckoutSession", () => {
  it("creates an embedded one-time payment checkout session", async () => {
    mockSessionsCreate.mockResolvedValue({ id: "cs_top", client_secret: "secret_top" });

    const result = await createTopUpCheckoutSession({
      customerId: "cus_1",
      priceId: "price_pack",
      userId: "user-1",
      packKey: "pack_2000",
      tokens: 2000,
    });

    expect(result).toEqual({ id: "cs_top", clientSecret: "secret_top" });
    expect(mockSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      mode: "payment",
      ui_mode: "embedded_page",
      metadata: expect.objectContaining({
        pack_key: "pack_2000",
        tokens: "2000",
        checkout_kind: "top_up",
      }),
      payment_intent_data: expect.objectContaining({
        metadata: expect.objectContaining({
          pack_key: "pack_2000",
          tokens: "2000",
        }),
      }),
    }));
  });

  it("throws when client_secret missing", async () => {
    mockSessionsCreate.mockResolvedValue({ id: "cs_top", client_secret: null });
    await expect(
      createTopUpCheckoutSession({
        customerId: "cus_1",
        priceId: "price_pack",
        userId: "user-1",
        packKey: "pack_500",
        tokens: 500,
      }),
    ).rejects.toThrow(/client_secret/);
  });

  it("uses a custom returnPath when provided", async () => {
    mockSessionsCreate.mockResolvedValue({ id: "cs_top2", client_secret: "secret_top2" });
    await createTopUpCheckoutSession({
      customerId: "cus_1",
      priceId: "price_pack",
      userId: "user-1",
      packKey: "pack_500",
      tokens: 500,
      returnPath: "/done?session_id={CHECKOUT_SESSION_ID}",
    });
    expect(mockSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      return_url: "https://app.test/done?session_id={CHECKOUT_SESSION_ID}",
    }));
  });
});

describe("createPortalSession", () => {
  it("creates a billing portal session", async () => {
    mockPortalCreate.mockResolvedValue({ url: "https://billing.stripe.com/x" });
    const result = await createPortalSession({ customerId: "cus_1" });
    expect(result).toEqual({ url: "https://billing.stripe.com/x" });
    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://app.test/account/billing",
    });
  });

  it("uses a custom returnPath", async () => {
    mockPortalCreate.mockResolvedValue({ url: "https://billing.stripe.com/y" });
    await createPortalSession({ customerId: "cus_1", returnPath: "/settings" });
    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://app.test/settings",
    });
  });
});

describe("retrieveCheckoutSession", () => {
  it("delegates to stripe.checkout.sessions.retrieve", async () => {
    mockSessionsRetrieve.mockResolvedValue({ id: "cs_1", payment_status: "paid" });
    const result = await retrieveCheckoutSession("cs_1");
    expect(result).toEqual({ id: "cs_1", payment_status: "paid" });
    expect(mockSessionsRetrieve).toHaveBeenCalledWith("cs_1");
  });
});

describe("verifyWebhook", () => {
  it("constructs a verified event from the raw body and signature", async () => {
    const event = { id: "evt_1", type: "checkout.session.completed" };
    mockConstructEventAsync.mockResolvedValue(event);

    const result = await verifyWebhook({ rawBody: "raw", signature: "sig" });
    expect(result).toBe(event);
    expect(mockConstructEventAsync).toHaveBeenCalledWith("raw", "sig", "whsec_x");
  });

  it("throws when STRIPE_WEBHOOK_SECRET is missing", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await expect(verifyWebhook({ rawBody: "raw", signature: "sig" })).rejects.toThrow(
      /Missing STRIPE_WEBHOOK_SECRET/,
    );
  });
});
