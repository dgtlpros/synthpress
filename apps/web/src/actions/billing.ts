"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  getActiveSubscription,
  getOrCreateStripeCustomer,
  getPlanByKey,
  syncSubscriptionFromStripe,
} from "@/services/billing-service";
import {
  createPortalSession,
  createSubscriptionCheckoutSession,
  createTopUpCheckoutSession,
  resumeSubscription as stripeResumeSubscription,
} from "@/services/stripe-service";
import { recordSubscriptionEvent } from "@/services/token-service";
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

  const priceId =
    interval === "year" ? plan.stripe_annual_price_id : plan.stripe_price_id;
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
      error:
        error instanceof Error ? error.message : "Could not start checkout.",
    };
  }
}

export async function createTopUpCheckout(
  packKey: string,
): Promise<CheckoutSessionResult> {
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
      error:
        err instanceof Error ? err.message : "Could not open billing portal.",
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

    // Stripe call returns the updated subscription. Sync our DB row from the
    // returned state immediately so the page re-renders correctly without
    // waiting for the webhook (which arrives asynchronously ~500ms later).
    const updatedStripeSub = await stripeResumeSubscription(
      subscription.stripe_subscription_id,
    );
    await syncSubscriptionFromStripe({
      stripeSub: updatedStripeSub,
      client: admin,
    });

    // Log the resume in the activity feed eagerly so the user sees the row
    // on next render. The webhook's transition detector will read the
    // already-synced DB state (was=false, now=false) and silently skip
    // logging again — no duplication.
    const periodEndIso = subscription.current_period_end
      ? new Date(subscription.current_period_end).toISOString()
      : null;
    const periodEndLabel = periodEndIso
      ? new Date(periodEndIso).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null;
    await recordSubscriptionEvent({
      userId: user.id,
      type: "subscription_resumed",
      description: periodEndLabel
        ? `Subscription resumed — renews on ${periodEndLabel}`
        : "Subscription resumed",
      // Synthetic, deterministic-per-call key. The webhook for the same
      // resume uses `${event.id}::resumed` so the keys never collide.
      stripeEventId: `manual::${user.id}::${subscription.stripe_subscription_id}::resumed::${Date.now()}`,
      metadata: {
        stripe_subscription_id: subscription.stripe_subscription_id,
        plan_key: subscription.plan_key,
        period_end: periodEndIso,
        source: "in_app_resume_action",
      },
      client: admin,
    });

    revalidatePath("/account/billing");
    revalidatePath("/account");
    return { ok: true };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Could not resume subscription.",
    };
  }
}
