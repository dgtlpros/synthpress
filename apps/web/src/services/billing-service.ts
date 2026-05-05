import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { findOrCreateCustomer } from "./stripe-service";
import { grantTokens } from "./token-service";

type Client = SupabaseClient<Database>;

export type Subscription = Tables<"subscriptions">;
export type Plan = Tables<"plans">;

const ACTIVE_STATUSES = ["active", "trialing", "past_due", "incomplete"] as const;

/**
 * Returns the persisted Stripe customer id for the user, creating one on
 * Stripe (and persisting it locally) the first time we need it.
 */
export async function getOrCreateStripeCustomer(params: {
  userId: string;
  email: string;
  client?: Client;
}): Promise<string> {
  const supabase = params.client ?? createAdminClient();

  const { data: existing, error } = await supabase
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", params.userId)
    .maybeSingle();

  if (error) throw error;

  if (existing?.stripe_customer_id) {
    return existing.stripe_customer_id;
  }

  const stripeCustomerId = await findOrCreateCustomer({
    email: params.email,
    userId: params.userId,
  });

  const { error: insertError } = await supabase
    .from("stripe_customers")
    .insert({ user_id: params.userId, stripe_customer_id: stripeCustomerId });

  if (insertError && insertError.code !== "23505") {
    throw insertError;
  }

  return stripeCustomerId;
}

export async function getActiveSubscription(
  userId: string,
  client?: Client,
): Promise<Subscription | null> {
  const supabase = client ?? createAdminClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ACTIVE_STATUSES as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function getCurrentPlan(
  userId: string,
  client?: Client,
): Promise<{ plan: Plan; subscription: Subscription } | null> {
  const supabase = client ?? createAdminClient();
  const subscription = await getActiveSubscription(userId, supabase);
  if (!subscription) return null;

  const { data: plan, error } = await supabase
    .from("plans")
    .select("*")
    .eq("key", subscription.plan_key)
    .maybeSingle();

  if (error) throw error;
  if (!plan) return null;

  return { plan, subscription };
}

export async function getPlanByStripePriceId(
  priceId: string,
  client?: Client,
): Promise<Plan | null> {
  const supabase = client ?? createAdminClient();
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("stripe_price_id", priceId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function getPlanByKey(planKey: string, client?: Client): Promise<Plan | null> {
  const supabase = client ?? createAdminClient();
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("key", planKey)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

function timestampToIso(value: number | null | undefined): string | null {
  if (!value) return null;
  return new Date(value * 1000).toISOString();
}

function buildSubscriptionRow(params: {
  stripeSub: Stripe.Subscription;
  userId: string;
  planKey: string;
}): TablesInsert<"subscriptions"> {
  const item = params.stripeSub.items.data[0];
  return {
    user_id: params.userId,
    stripe_subscription_id: params.stripeSub.id,
    stripe_price_id: item.price.id,
    plan_key: params.planKey,
    status: params.stripeSub.status,
    current_period_start: timestampToIso(item.current_period_start),
    current_period_end: timestampToIso(item.current_period_end),
    cancel_at_period_end: params.stripeSub.cancel_at_period_end,
    canceled_at: timestampToIso(params.stripeSub.canceled_at),
  };
}

/**
 * Resolves the user_id and plan_key for a Stripe subscription, falling back
 * from metadata to lookups when needed.
 */
async function resolveSubscriptionContext(
  stripeSub: Stripe.Subscription,
  client: Client,
): Promise<{ userId: string; planKey: string } | null> {
  const userId =
    (typeof stripeSub.metadata?.supabase_user_id === "string" && stripeSub.metadata.supabase_user_id) ||
    null;

  if (!userId) return null;

  const metadataPlanKey =
    typeof stripeSub.metadata?.plan_key === "string" ? stripeSub.metadata.plan_key : null;

  if (metadataPlanKey) {
    return { userId, planKey: metadataPlanKey };
  }

  const priceId = stripeSub.items.data[0]?.price.id;
  if (!priceId) return null;

  const plan = await getPlanByStripePriceId(priceId, client);
  if (!plan) return null;

  return { userId, planKey: plan.key };
}

export async function syncSubscriptionFromStripe(params: {
  stripeSub: Stripe.Subscription;
  client?: Client;
}): Promise<{ userId: string; planKey: string } | null> {
  const supabase = params.client ?? createAdminClient();

  const ctx = await resolveSubscriptionContext(params.stripeSub, supabase);
  if (!ctx) return null;

  const row = buildSubscriptionRow({
    stripeSub: params.stripeSub,
    userId: ctx.userId,
    planKey: ctx.planKey,
  });

  const { error } = await supabase
    .from("subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" });

  if (error) throw error;

  return ctx;
}

// ============================================================================
// Webhook handlers (idempotent)
// ============================================================================

export async function handleCheckoutCompleted(
  event: Stripe.CheckoutSessionCompletedEvent,
  options: {
    client?: Client;
    retrieveSubscription?: (id: string) => Promise<Stripe.Subscription>;
  } = {},
): Promise<void> {
  const supabase = options.client ?? createAdminClient();
  const session = event.data.object;

  const userId =
    typeof session.metadata?.supabase_user_id === "string"
      ? session.metadata.supabase_user_id
      : null;
  if (!userId) return;

  if (session.mode === "subscription") {
    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    if (!subscriptionId || !options.retrieveSubscription) return;

    const stripeSub = await options.retrieveSubscription(subscriptionId);
    const ctx = await syncSubscriptionFromStripe({ stripeSub, client: supabase });
    if (!ctx) return;

    const plan = await getPlanByKey(ctx.planKey, supabase);
    if (!plan) return;

    await grantTokens({
      userId: ctx.userId,
      amount: plan.monthly_tokens,
      type: "subscription_grant",
      description: `${plan.name} plan — initial grant`,
      stripeEventId: event.id,
      metadata: { stripe_subscription_id: stripeSub.id, plan_key: plan.key },
      client: supabase,
    });
    return;
  }

  if (session.mode === "payment") {
    const packKey =
      typeof session.metadata?.pack_key === "string" ? session.metadata.pack_key : null;
    const tokensRaw =
      typeof session.metadata?.tokens === "string" ? session.metadata.tokens : null;
    const tokens = tokensRaw ? Number.parseInt(tokensRaw, 10) : NaN;
    if (!packKey || !Number.isFinite(tokens) || tokens <= 0) return;

    await grantTokens({
      userId,
      amount: tokens,
      type: "top_up_purchase",
      description: `Top-up: ${packKey}`,
      stripeEventId: event.id,
      metadata: { pack_key: packKey, checkout_session_id: session.id },
      client: supabase,
    });
  }
}

export async function handleSubscriptionUpdated(
  event:
    | Stripe.CustomerSubscriptionUpdatedEvent
    | Stripe.CustomerSubscriptionCreatedEvent
    | Stripe.CustomerSubscriptionDeletedEvent,
  options: { client?: Client } = {},
): Promise<void> {
  const supabase = options.client ?? createAdminClient();
  await syncSubscriptionFromStripe({
    stripeSub: event.data.object,
    client: supabase,
  });
}

export async function handleInvoicePaymentSucceeded(
  event: Stripe.InvoicePaymentSucceededEvent,
  options: {
    client?: Client;
    retrieveSubscription?: (id: string) => Promise<Stripe.Subscription>;
  } = {},
): Promise<void> {
  const supabase = options.client ?? createAdminClient();
  const invoice = event.data.object;

  if (invoice.billing_reason !== "subscription_cycle") return;

  const subscriptionField = (invoice as unknown as { subscription?: string | { id: string } | null })
    .subscription;
  const subscriptionId =
    typeof subscriptionField === "string"
      ? subscriptionField
      : subscriptionField?.id ?? null;
  if (!subscriptionId || !options.retrieveSubscription) return;

  const stripeSub = await options.retrieveSubscription(subscriptionId);
  const ctx = await syncSubscriptionFromStripe({ stripeSub, client: supabase });
  if (!ctx) return;

  const plan = await getPlanByKey(ctx.planKey, supabase);
  if (!plan) return;

  await grantTokens({
    userId: ctx.userId,
    amount: plan.monthly_tokens,
    type: "subscription_grant",
    description: `${plan.name} plan — monthly renewal`,
    stripeEventId: event.id,
    metadata: { stripe_subscription_id: stripeSub.id, plan_key: plan.key },
    client: supabase,
  });
}

export async function handleInvoicePaymentFailed(
  event: Stripe.InvoicePaymentFailedEvent,
  options: { client?: Client } = {},
): Promise<void> {
  const supabase = options.client ?? createAdminClient();
  const invoice = event.data.object;

  const subscriptionField = (invoice as unknown as { subscription?: string | { id: string } | null })
    .subscription;
  const subscriptionId =
    typeof subscriptionField === "string"
      ? subscriptionField
      : subscriptionField?.id ?? null;
  if (!subscriptionId) return;

  const { error } = await supabase
    .from("subscriptions")
    .update({ status: "past_due" })
    .eq("stripe_subscription_id", subscriptionId);

  if (error) throw error;
}

export interface WebhookHandlerOptions {
  client?: Client;
  retrieveSubscription?: (id: string) => Promise<Stripe.Subscription>;
}

export async function handleWebhookEvent(
  event: Stripe.Event,
  options: WebhookHandlerOptions = {},
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event, options);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscriptionUpdated(event, options);
      break;
    case "invoice.payment_succeeded":
      await handleInvoicePaymentSucceeded(event, options);
      break;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event, options);
      break;
    default:
      break;
  }
}
