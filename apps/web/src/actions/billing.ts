"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  getActiveSubscription,
  getOrCreateStripeCustomer,
  getPlanByKey,
} from "@/services/billing-service";
import {
  createPortalSession,
  createSubscriptionCheckoutSession,
  createTopUpCheckoutSession,
  resumeSubscription as stripeResumeSubscription,
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

export interface ResumeSubscriptionResult {
  ok?: true;
  error?: string;
}

export type CheckoutInterval = "month" | "year";

export async function createSubscriptionCheckout(
  planKey: string,
  interval: CheckoutInterval = "month",
): Promise<CheckoutSessionResult> {
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

  const priceId = interval === "year" ? plan.stripe_annual_price_id : plan.stripe_price_id;
  if (!priceId) {
    if (interval === "year") {
      return { error: `Plan "${plan.name}" doesn't have an annual price.` };
    }
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
      priceId,
      userId: user.id,
      planKey: plan.key,
      interval,
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

export async function resumeSubscription(): Promise<ResumeSubscriptionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to resume a subscription." };
  }

  const admin = createAdminClient();

  try {
    const subscription = await getActiveSubscription(user.id, admin);
    if (!subscription) {
      return { error: "No active subscription to resume." };
    }
    if (!subscription.cancel_at_period_end) {
      return { error: "This subscription is not scheduled for cancellation." };
    }

    await stripeResumeSubscription(subscription.stripe_subscription_id);
    revalidatePath("/account/billing");
    revalidatePath("/account");
    return { ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not resume subscription.",
    };
  }
}
