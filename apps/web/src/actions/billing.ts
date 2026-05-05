"use server";

import { createClient } from "@/lib/supabase/server";
import { getOrCreateStripeCustomer, getPlanByKey } from "@/services/billing-service";
import {
  createPortalSession,
  createSubscriptionCheckoutSession,
  createTopUpCheckoutSession,
} from "@/services/stripe-service";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CheckoutSessionResult {
  clientSecret?: string;
  error?: string;
}

export interface PortalSessionResult {
  url?: string;
  error?: string;
}

export async function createSubscriptionCheckout(planKey: string): Promise<CheckoutSessionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return { error: "You must be signed in to subscribe." };
  }

  const admin = createAdminClient();
  const plan = await getPlanByKey(planKey, admin);
  if (!plan) {
    return { error: `Unknown plan: ${planKey}` };
  }
  if (!plan.stripe_price_id) {
    return { error: `Plan "${plan.name}" is not currently for sale.` };
  }

  try {
    const customerId = await getOrCreateStripeCustomer({
      userId: user.id,
      email: user.email,
      client: admin,
    });

    const session = await createSubscriptionCheckoutSession({
      customerId,
      priceId: plan.stripe_price_id,
      userId: user.id,
      planKey: plan.key,
    });

    return { clientSecret: session.clientSecret };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not start checkout.",
    };
  }
}

export async function createTopUpCheckout(packKey: string): Promise<CheckoutSessionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return { error: "You must be signed in to purchase tokens." };
  }

  const admin = createAdminClient();
  const { data: pack, error } = await admin
    .from("token_packs")
    .select("*")
    .eq("key", packKey)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!pack) return { error: `Unknown token pack: ${packKey}` };

  try {
    const customerId = await getOrCreateStripeCustomer({
      userId: user.id,
      email: user.email,
      client: admin,
    });

    const session = await createTopUpCheckoutSession({
      customerId,
      priceId: pack.stripe_price_id,
      userId: user.id,
      packKey: pack.key,
      tokens: pack.tokens,
    });

    return { clientSecret: session.clientSecret };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not start checkout.",
    };
  }
}

export async function createBillingPortal(): Promise<PortalSessionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return { error: "You must be signed in to manage billing." };
  }

  const admin = createAdminClient();

  try {
    const customerId = await getOrCreateStripeCustomer({
      userId: user.id,
      email: user.email,
      client: admin,
    });

    const session = await createPortalSession({ customerId });
    return { url: session.url };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not open billing portal.",
    };
  }
}
