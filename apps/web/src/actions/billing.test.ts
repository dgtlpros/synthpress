import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/services/billing-service", () => ({
  getActiveSubscription: vi.fn(),
  getOrCreateStripeCustomer: vi.fn(),
  getPlanByKey: vi.fn(),
  syncSubscriptionFromStripe: vi.fn(),
}));

vi.mock("@/services/stripe-service", () => ({
  createSubscriptionCheckoutSession: vi.fn(),
  createTopUpCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  resumeSubscription: vi.fn(),
}));

vi.mock("@/services/token-service", () => ({
  recordSubscriptionEvent: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getActiveSubscription,
  getOrCreateStripeCustomer,
  getPlanByKey,
  syncSubscriptionFromStripe,
} from "@/services/billing-service";
import {
  createSubscriptionCheckoutSession,
  createTopUpCheckoutSession,
  createPortalSession,
  resumeSubscription as stripeResumeSubscription,
} from "@/services/stripe-service";
import { recordSubscriptionEvent } from "@/services/token-service";
import {
  createSubscriptionCheckout,
  createTopUpCheckout,
  createBillingPortal,
  resumeSubscription,
} from "./billing";

const mockedRevalidatePath = vi.mocked(revalidatePath);
const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdmin = vi.mocked(createAdminClient);
const mockedGetActiveSub = vi.mocked(getActiveSubscription);
const mockedGetOrCreate = vi.mocked(getOrCreateStripeCustomer);
const mockedGetPlanByKey = vi.mocked(getPlanByKey);
const mockedSubCheckout = vi.mocked(createSubscriptionCheckoutSession);
const mockedTopUpCheckout = vi.mocked(createTopUpCheckoutSession);
const mockedPortal = vi.mocked(createPortalSession);
const mockedStripeResume = vi.mocked(stripeResumeSubscription);
const mockedSyncSub = vi.mocked(syncSubscriptionFromStripe);
const mockedRecordEvent = vi.mocked(recordSubscriptionEvent);

function mockSupabase(user: { id: string; email: string } | null) {
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateAdmin.mockReturnValue({} as never);
});

describe("createSubscriptionCheckout", () => {
  it("returns error when not signed in", async () => {
    mockSupabase(null);
    const result = await createSubscriptionCheckout("pro");
    expect(result).toEqual({ error: "You must be signed in to subscribe." });
  });

  it("returns error when user has no email", async () => {
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
    } as never);
    const result = await createSubscriptionCheckout("pro");
    expect(result.error).toMatch(/signed in/);
  });

  it("returns error when plan does not exist", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetPlanByKey.mockResolvedValue(null);
    const result = await createSubscriptionCheckout("ghost");
    expect(result).toEqual({ error: "Unknown plan: ghost" });
  });

  it("returns error when plan has no stripe_price_id", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetPlanByKey.mockResolvedValue({
      key: "pro",
      name: "Pro",
      stripe_price_id: null,
      stripe_annual_price_id: null,
    } as never);
    const result = await createSubscriptionCheckout("pro");
    expect(result.error).toMatch(/not currently for sale/);
  });

  it("creates a monthly checkout by default", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetPlanByKey.mockResolvedValue({
      key: "pro",
      name: "Pro",
      stripe_price_id: "price_pro_month",
      stripe_annual_price_id: "price_pro_year",
    } as never);
    mockedGetOrCreate.mockResolvedValue("cus_1");
    mockedSubCheckout.mockResolvedValue({
      id: "cs_1",
      clientSecret: "secret_1",
    });

    const result = await createSubscriptionCheckout("pro");
    expect(result).toEqual({ clientSecret: "secret_1" });
    expect(mockedSubCheckout).toHaveBeenCalledWith({
      customerId: "cus_1",
      priceId: "price_pro_month",
      userId: "u1",
      planKey: "pro",
      interval: "month",
    });
  });

  it("creates an annual checkout when interval=year", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetPlanByKey.mockResolvedValue({
      key: "pro",
      name: "Pro",
      stripe_price_id: "price_pro_month",
      stripe_annual_price_id: "price_pro_year",
    } as never);
    mockedGetOrCreate.mockResolvedValue("cus_1");
    mockedSubCheckout.mockResolvedValue({
      id: "cs_y",
      clientSecret: "secret_y",
    });

    const result = await createSubscriptionCheckout("pro", "year");
    expect(result).toEqual({ clientSecret: "secret_y" });
    expect(mockedSubCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        priceId: "price_pro_year",
        interval: "year",
      }),
    );
  });

  it("returns a clear error when plan has no annual price and interval=year", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetPlanByKey.mockResolvedValue({
      key: "pro",
      name: "Pro",
      stripe_price_id: "price_pro_month",
      stripe_annual_price_id: null,
    } as never);

    const result = await createSubscriptionCheckout("pro", "year");
    expect(result.error).toMatch(/doesn't have an annual price/);
  });

  it("returns error message on Stripe failure", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetPlanByKey.mockResolvedValue({
      key: "pro",
      name: "Pro",
      stripe_price_id: "price_pro",
      stripe_annual_price_id: null,
    } as never);
    mockedGetOrCreate.mockRejectedValue(new Error("stripe down"));

    const result = await createSubscriptionCheckout("pro");
    expect(result).toEqual({ error: "stripe down" });
  });

  it("returns generic error on non-Error rejection", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetPlanByKey.mockResolvedValue({
      key: "pro",
      name: "Pro",
      stripe_price_id: "price_pro",
      stripe_annual_price_id: null,
    } as never);
    mockedGetOrCreate.mockRejectedValue("nope");

    const result = await createSubscriptionCheckout("pro");
    expect(result).toEqual({ error: "Could not start checkout." });
  });
});

describe("createTopUpCheckout", () => {
  function mockTokenPack(
    pack: unknown,
    error: { message?: string } | null = null,
  ) {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: pack, error }),
    };
    mockedCreateAdmin.mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    } as never);
  }

  it("returns error when not signed in", async () => {
    mockSupabase(null);
    const result = await createTopUpCheckout("pack_500");
    expect(result.error).toMatch(/signed in/);
  });

  it("returns error when user has no email", async () => {
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
    } as never);
    const result = await createTopUpCheckout("pack_500");
    expect(result.error).toMatch(/signed in/);
  });

  it("returns error when pack lookup fails", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockTokenPack(null, { message: "db boom" });
    const result = await createTopUpCheckout("pack_500");
    expect(result).toEqual({ error: "db boom" });
  });

  it("returns error when pack does not exist", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockTokenPack(null);
    const result = await createTopUpCheckout("missing");
    expect(result.error).toMatch(/Unknown token pack: missing/);
  });

  it("creates checkout and returns clientSecret", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockTokenPack({
      key: "pack_500",
      stripe_price_id: "price_pack",
      tokens: 500,
    });
    mockedGetOrCreate.mockResolvedValue("cus_1");
    mockedTopUpCheckout.mockResolvedValue({
      id: "cs_t",
      clientSecret: "secret_t",
    });

    const result = await createTopUpCheckout("pack_500");
    expect(result).toEqual({ clientSecret: "secret_t" });
    expect(mockedTopUpCheckout).toHaveBeenCalledWith({
      customerId: "cus_1",
      priceId: "price_pack",
      userId: "u1",
      packKey: "pack_500",
      tokens: 500,
    });
  });

  it("returns error message on Stripe failure", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockTokenPack({
      key: "pack_500",
      stripe_price_id: "price_pack",
      tokens: 500,
    });
    mockedGetOrCreate.mockRejectedValue(new Error("network"));

    const result = await createTopUpCheckout("pack_500");
    expect(result).toEqual({ error: "network" });
  });

  it("returns generic error on non-Error rejection", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockTokenPack({
      key: "pack_500",
      stripe_price_id: "price_pack",
      tokens: 500,
    });
    mockedGetOrCreate.mockRejectedValue("oops");

    const result = await createTopUpCheckout("pack_500");
    expect(result).toEqual({ error: "Could not start checkout." });
  });
});

describe("resumeSubscription", () => {
  it("returns error when not signed in", async () => {
    mockSupabase(null);
    const result = await resumeSubscription();
    expect(result.error).toMatch(/signed in/);
  });

  it("returns error when there is no active subscription", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetActiveSub.mockResolvedValue(null);

    const result = await resumeSubscription();
    expect(result).toEqual({ error: "No active subscription to resume." });
  });

  it("returns error when sub is not scheduled for cancellation", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetActiveSub.mockResolvedValue({
      stripe_subscription_id: "sub_1",
      cancel_at_period_end: false,
    } as never);

    const result = await resumeSubscription();
    expect(result.error).toMatch(/not scheduled for cancellation/);
    expect(mockedStripeResume).not.toHaveBeenCalled();
  });

  it("calls Stripe, syncs the DB, logs the activity row, and revalidates", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetActiveSub.mockResolvedValue({
      stripe_subscription_id: "sub_1",
      cancel_at_period_end: true,
      plan_key: "pro",
      current_period_end: "2026-06-05T22:34:52.000Z",
    } as never);
    const updatedSub = {
      id: "sub_1",
      cancel_at_period_end: false,
    } as never;
    mockedStripeResume.mockResolvedValue(updatedSub);

    const result = await resumeSubscription();

    expect(result).toEqual({ ok: true });
    expect(mockedStripeResume).toHaveBeenCalledWith("sub_1");
    expect(mockedSyncSub).toHaveBeenCalledWith({
      stripeSub: updatedSub,
      client: expect.any(Object),
    });
    expect(mockedRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        type: "subscription_resumed",
        description: expect.stringContaining("Subscription resumed"),
        stripeEventId: expect.stringContaining("manual::u1::sub_1::resumed::"),
        metadata: expect.objectContaining({
          stripe_subscription_id: "sub_1",
          plan_key: "pro",
          source: "in_app_resume_action",
        }),
      }),
    );
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/account/billing");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/account");
  });

  it("falls back to a date-less description when current_period_end is null", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetActiveSub.mockResolvedValue({
      stripe_subscription_id: "sub_1",
      cancel_at_period_end: true,
      plan_key: "pro",
      current_period_end: null,
    } as never);
    mockedStripeResume.mockResolvedValue({} as never);

    await resumeSubscription();

    expect(mockedRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Subscription resumed",
      }),
    );
  });

  it("returns error message on Stripe failure", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetActiveSub.mockResolvedValue({
      stripe_subscription_id: "sub_1",
      cancel_at_period_end: true,
    } as never);
    mockedStripeResume.mockRejectedValue(new Error("stripe down"));

    const result = await resumeSubscription();
    expect(result).toEqual({ error: "stripe down" });
    expect(mockedSyncSub).not.toHaveBeenCalled();
    expect(mockedRecordEvent).not.toHaveBeenCalled();
  });

  it("returns generic error on non-Error rejection", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetActiveSub.mockResolvedValue({
      stripe_subscription_id: "sub_1",
      cancel_at_period_end: true,
    } as never);
    mockedStripeResume.mockRejectedValue("nope");

    const result = await resumeSubscription();
    expect(result).toEqual({ error: "Could not resume subscription." });
  });
});

describe("createBillingPortal", () => {
  it("returns error when not signed in", async () => {
    mockSupabase(null);
    const result = await createBillingPortal();
    expect(result.error).toMatch(/signed in/);
  });

  it("returns error when user has no email", async () => {
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
    } as never);
    const result = await createBillingPortal();
    expect(result.error).toMatch(/signed in/);
  });

  it("returns the portal URL", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetOrCreate.mockResolvedValue("cus_1");
    mockedPortal.mockResolvedValue({ url: "https://billing.stripe.com/x" });

    const result = await createBillingPortal();
    expect(result).toEqual({ url: "https://billing.stripe.com/x" });
    expect(mockedPortal).toHaveBeenCalledWith({ customerId: "cus_1" });
  });

  it("returns error message on failure", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetOrCreate.mockRejectedValue(new Error("boom"));

    const result = await createBillingPortal();
    expect(result).toEqual({ error: "boom" });
  });

  it("returns generic error on non-Error rejection", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetOrCreate.mockRejectedValue("oops");

    const result = await createBillingPortal();
    expect(result).toEqual({ error: "Could not open billing portal." });
  });
});
