import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const {
  mockSessionsCreate,
  mockSessionsRetrieve,
  mockCustomersCreate,
  mockPortalCreate,
  mockConstructEventAsync,
  mockSubscriptionsUpdate,
  mockInvoicesList,
  StripeMock,
} = vi.hoisted(() => {
  const mockSessionsCreate = vi.fn();
  const mockSessionsRetrieve = vi.fn();
  const mockCustomersCreate = vi.fn();
  const mockPortalCreate = vi.fn();
  const mockConstructEventAsync = vi.fn();
  const mockSubscriptionsUpdate = vi.fn();
  const mockInvoicesList = vi.fn();
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
      subscriptions: {
        update: mockSubscriptionsUpdate,
      },
      invoices: {
        list: mockInvoicesList,
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
    mockSubscriptionsUpdate,
    mockInvoicesList,
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
  resumeSubscription,
  verifyWebhook,
  getCustomerInvoices,
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
        interval: "month",
        checkout_kind: "subscription",
      }),
      subscription_data: expect.objectContaining({
        metadata: expect.objectContaining({ interval: "month" }),
      }),
    }));
    // Tax + customer_update intentionally not enabled until jurisdictions
    // are registered in Stripe Tax.
    const args = mockSessionsCreate.mock.calls[0][0];
    expect(args).not.toHaveProperty("automatic_tax");
    expect(args).not.toHaveProperty("customer_update");
  });

  it("propagates the interval into metadata when set to year", async () => {
    mockSessionsCreate.mockResolvedValue({ id: "cs_y", client_secret: "secret_y" });

    await createSubscriptionCheckoutSession({
      customerId: "cus_1",
      priceId: "price_y",
      userId: "user-1",
      planKey: "pro",
      interval: "year",
    });

    expect(mockSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ interval: "year" }),
      subscription_data: expect.objectContaining({
        metadata: expect.objectContaining({ interval: "year" }),
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
    const args = mockSessionsCreate.mock.calls[0][0];
    expect(args).not.toHaveProperty("automatic_tax");
    expect(args).not.toHaveProperty("customer_update");
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

describe("resumeSubscription", () => {
  it("clears cancel_at_period_end on the given subscription", async () => {
    mockSubscriptionsUpdate.mockResolvedValue({ id: "sub_1" });

    await resumeSubscription("sub_1");

    expect(mockSubscriptionsUpdate).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: false,
    });
  });

  it("propagates Stripe errors", async () => {
    mockSubscriptionsUpdate.mockRejectedValue(new Error("not found"));
    await expect(resumeSubscription("sub_x")).rejects.toThrow("not found");
  });
});

describe("getCustomerInvoices", () => {
  it("returns mapped DTOs for the customer's recent invoices", async () => {
    mockInvoicesList.mockResolvedValue({
      data: [
        {
          id: "in_paid",
          number: "INV-001",
          status: "paid",
          amount_paid: 7900,
          amount_due: 7900,
          currency: "usd",
          created: 1_700_000_000,
          period_start: 1_697_408_000,
          period_end: 1_700_000_000,
          description: "Pro plan — May",
          invoice_pdf: "https://files.stripe.com/v1/invoices/in_paid.pdf",
          hosted_invoice_url: "https://invoice.stripe.com/i/acct_x/in_paid",
        },
      ],
    });

    const invoices = await getCustomerInvoices("cus_1");

    expect(mockInvoicesList).toHaveBeenCalledWith({ customer: "cus_1", limit: 12 });
    expect(invoices).toEqual([
      {
        id: "in_paid",
        number: "INV-001",
        status: "paid",
        amountPaid: 7900,
        amountDue: 7900,
        currency: "usd",
        createdAt: 1_700_000_000,
        periodStart: 1_697_408_000,
        periodEnd: 1_700_000_000,
        description: "Pro plan — May",
        pdfUrl: "https://files.stripe.com/v1/invoices/in_paid.pdf",
        hostedUrl: "https://invoice.stripe.com/i/acct_x/in_paid",
      },
    ]);
  });

  it("respects a custom limit", async () => {
    mockInvoicesList.mockResolvedValue({ data: [] });
    await getCustomerInvoices("cus_2", 50);
    expect(mockInvoicesList).toHaveBeenCalledWith({ customer: "cus_2", limit: 50 });
  });

  it("normalizes unknown statuses to 'unknown' and tolerates missing fields", async () => {
    mockInvoicesList.mockResolvedValue({
      data: [
        {
          id: "in_weird",
          number: null,
          status: "something_new",
          amount_paid: 0,
          amount_due: 0,
          currency: "usd",
          created: 1_700_000_000,
          period_start: null,
          period_end: null,
          description: null,
          invoice_pdf: null,
          hosted_invoice_url: null,
        },
      ],
    });

    const invoices = await getCustomerInvoices("cus_3");
    expect(invoices[0]).toMatchObject({
      id: "in_weird",
      number: null,
      status: "unknown",
      pdfUrl: null,
      hostedUrl: null,
    });
  });

  it("returns an empty list when the customer has no invoices yet", async () => {
    mockInvoicesList.mockResolvedValue({ data: [] });
    const invoices = await getCustomerInvoices("cus_empty");
    expect(invoices).toEqual([]);
  });

  it("falls back to defaults when invoice fields are missing entirely", async () => {
    mockInvoicesList.mockResolvedValue({
      data: [
        {
          // Bare minimum — exercises every `??` fallback in the mapper.
          created: 1_700_000_000,
        },
      ],
    });

    const invoices = await getCustomerInvoices("cus_sparse");
    expect(invoices[0]).toEqual({
      id: "",
      number: null,
      status: "unknown",
      amountPaid: 0,
      amountDue: 0,
      currency: "usd",
      createdAt: 1_700_000_000,
      periodStart: null,
      periodEnd: null,
      description: null,
      pdfUrl: null,
      hostedUrl: null,
    });
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
