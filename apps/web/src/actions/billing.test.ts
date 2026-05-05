import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/services/billing-service", () => ({
  getOrCreateStripeCustomer: vi.fn(),
  getPlanByKey: vi.fn(),
}));

vi.mock("@/services/stripe-service", () => ({
  createSubscriptionCheckoutSession: vi.fn(),
  createTopUpCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getOrCreateStripeCustomer,
  getPlanByKey,
} from "@/services/billing-service";
import {
  createSubscriptionCheckoutSession,
  createTopUpCheckoutSession,
  createPortalSession,
} from "@/services/stripe-service";
import {
  createSubscriptionCheckout,
  createTopUpCheckout,
  createBillingPortal,
} from "./billing";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdmin = vi.mocked(createAdminClient);
const mockedGetOrCreate = vi.mocked(getOrCreateStripeCustomer);
const mockedGetPlanByKey = vi.mocked(getPlanByKey);
const mockedSubCheckout = vi.mocked(createSubscriptionCheckoutSession);
const mockedTopUpCheckout = vi.mocked(createTopUpCheckoutSession);
const mockedPortal = vi.mocked(createPortalSession);

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
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
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
    } as never);
    const result = await createSubscriptionCheckout("pro");
    expect(result.error).toMatch(/not currently for sale/);
  });

  it("creates checkout and returns clientSecret", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetPlanByKey.mockResolvedValue({
      key: "pro",
      name: "Pro",
      stripe_price_id: "price_pro",
    } as never);
    mockedGetOrCreate.mockResolvedValue("cus_1");
    mockedSubCheckout.mockResolvedValue({ id: "cs_1", clientSecret: "secret_1" });

    const result = await createSubscriptionCheckout("pro");
    expect(result).toEqual({ clientSecret: "secret_1" });
    expect(mockedSubCheckout).toHaveBeenCalledWith({
      customerId: "cus_1",
      priceId: "price_pro",
      userId: "u1",
      planKey: "pro",
    });
  });

  it("returns error message on Stripe failure", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockedGetPlanByKey.mockResolvedValue({
      key: "pro",
      name: "Pro",
      stripe_price_id: "price_pro",
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
    } as never);
    mockedGetOrCreate.mockRejectedValue("nope");

    const result = await createSubscriptionCheckout("pro");
    expect(result).toEqual({ error: "Could not start checkout." });
  });
});

describe("createTopUpCheckout", () => {
  function mockTokenPack(pack: unknown, error: { message?: string } | null = null) {
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
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
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
    mockedTopUpCheckout.mockResolvedValue({ id: "cs_t", clientSecret: "secret_t" });

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
    mockTokenPack({ key: "pack_500", stripe_price_id: "price_pack", tokens: 500 });
    mockedGetOrCreate.mockRejectedValue(new Error("network"));

    const result = await createTopUpCheckout("pack_500");
    expect(result).toEqual({ error: "network" });
  });

  it("returns generic error on non-Error rejection", async () => {
    mockSupabase({ id: "u1", email: "u@test.com" });
    mockTokenPack({ key: "pack_500", stripe_price_id: "price_pack", tokens: 500 });
    mockedGetOrCreate.mockRejectedValue("oops");

    const result = await createTopUpCheckout("pack_500");
    expect(result).toEqual({ error: "Could not start checkout." });
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
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
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
