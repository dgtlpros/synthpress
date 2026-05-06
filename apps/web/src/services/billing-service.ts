import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  Tables,
  TablesInsert,
} from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { findOrCreateCustomer } from "./stripe-service";
import {
  grantTokens,
  recordSubscriptionEvent,
  recordTokenRefund,
} from "./token-service";

type Client = SupabaseClient<Database>;

export type Subscription = Tables<"subscriptions">;
export type Plan = Tables<"plans">;

const ACTIVE_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "incomplete",
] as const;

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

/**
 * Looks up the plan by its Stripe Price id, matching either the monthly or
 * annual price. We accept both because a single plan has two prices in Stripe
 * (one per cadence) and a subscription's `stripe_price_id` could be either.
 */
export async function getPlanByStripePriceId(
  priceId: string,
  client?: Client,
): Promise<Plan | null> {
  const supabase = client ?? createAdminClient();
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .or(`stripe_price_id.eq.${priceId},stripe_annual_price_id.eq.${priceId}`)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function getPlanByKey(
  planKey: string,
  client?: Client,
): Promise<Plan | null> {
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

function getSubscriptionInterval(
  stripeSub: Stripe.Subscription,
): "month" | "year" | null {
  const interval = stripeSub.items.data[0]?.price.recurring?.interval ?? null;
  if (interval === "month" || interval === "year") return interval;
  return null;
}

/**
 * Annual subscriptions prepay for the full year, so we grant 12 cycles of
 * tokens up-front. Monthly subscriptions get one cycle per invoice.
 */
function tokensForCycle(plan: Plan, stripeSub: Stripe.Subscription): number {
  return getSubscriptionInterval(stripeSub) === "year"
    ? plan.monthly_tokens * 12
    : plan.monthly_tokens;
}

function extractInvoiceIdFromSubscription(
  stripeSub: Stripe.Subscription,
): string | null {
  const latest = (
    stripeSub as unknown as { latest_invoice?: string | { id: string } | null }
  ).latest_invoice;
  if (typeof latest === "string") return latest;
  if (latest && typeof latest === "object" && "id" in latest) return latest.id;
  return null;
}

/**
 * Stripe API 2024-11-20.acacia and later moved `invoice.subscription` into
 * `invoice.parent.subscription_details.subscription`. We read the new field
 * first and fall back to the legacy field so older API versions still work.
 */
function extractSubscriptionIdFromInvoice(
  invoice: Stripe.Invoice,
): string | null {
  const parent = (
    invoice as unknown as {
      parent?: {
        subscription_details?: {
          subscription?: string | { id: string } | null;
        } | null;
      } | null;
    }
  ).parent;
  const fromParent = parent?.subscription_details?.subscription ?? null;
  if (typeof fromParent === "string") return fromParent;
  if (fromParent && typeof fromParent === "object" && "id" in fromParent) {
    return fromParent.id;
  }

  const legacy =
    (invoice as unknown as { subscription?: string | { id: string } | null })
      .subscription ?? null;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object" && "id" in legacy) return legacy.id;

  return null;
}

/**
 * Modern Stripe API (2024-11+) deprecated the boolean `cancel_at_period_end`
 * in favour of the timestamp field `cancel_at`. The Customer Portal in
 * particular sets `cancel_at` (== `current_period_end`) and leaves the
 * boolean at `false`, so we must consider both signals to know whether a
 * subscription is scheduled for cancellation.
 */
function isScheduledToCancel(stripeSub: Stripe.Subscription): boolean {
  if (stripeSub.cancel_at_period_end) return true;
  const cancelAt =
    (stripeSub as unknown as { cancel_at?: number | null }).cancel_at ?? null;
  return cancelAt !== null;
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
    cancel_at_period_end: isScheduledToCancel(params.stripeSub),
    canceled_at: timestampToIso(params.stripeSub.canceled_at),
  };
}

/**
 * Resolves the user_id and plan_key for a Stripe subscription.
 *
 * IMPORTANT: the plan_key is derived from the *current* Stripe Price id, NOT
 * from `subscription.metadata.plan_key`. Stripe doesn't auto-update metadata
 * when a customer (or admin) switches plans via the Customer Portal or the
 * Stripe Dashboard, so the price id is the only reliable source of truth.
 *
 * Metadata is used as a fallback when the current price doesn't match any
 * known plan (e.g. a custom one-off price was attached to the subscription).
 */
async function resolveSubscriptionContext(
  stripeSub: Stripe.Subscription,
  client: Client,
): Promise<{ userId: string; planKey: string } | null> {
  const userId =
    (typeof stripeSub.metadata?.supabase_user_id === "string" &&
      stripeSub.metadata.supabase_user_id) ||
    null;

  if (!userId) return null;

  const priceId = stripeSub.items.data[0]?.price.id;
  if (priceId) {
    const plan = await getPlanByStripePriceId(priceId, client);
    if (plan) {
      return { userId, planKey: plan.key };
    }
  }

  // Fallback: subscription is on a price we don't know about (custom price,
  // legacy plan, etc.). Trust the metadata if it points at a known plan_key.
  const metadataPlanKey =
    typeof stripeSub.metadata?.plan_key === "string"
      ? stripeSub.metadata.plan_key
      : null;

  if (metadataPlanKey) {
    return { userId, planKey: metadataPlanKey };
  }

  return null;
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
    const ctx = await syncSubscriptionFromStripe({
      stripeSub,
      client: supabase,
    });
    if (!ctx) return;

    const plan = await getPlanByKey(ctx.planKey, supabase);
    if (!plan) return;

    const interval = getSubscriptionInterval(stripeSub);
    const amount = tokensForCycle(plan, stripeSub);
    const cadence = interval === "year" ? "annual" : "monthly";
    const invoiceId = extractInvoiceIdFromSubscription(stripeSub);

    await grantTokens({
      userId: ctx.userId,
      amount,
      type: "subscription_grant",
      description: `${plan.name} plan — initial ${cadence} grant`,
      stripeEventId: event.id,
      metadata: {
        stripe_subscription_id: stripeSub.id,
        stripe_invoice_id: invoiceId,
        plan_key: plan.key,
        interval: interval ?? "month",
      },
      client: supabase,
    });
    return;
  }

  if (session.mode === "payment") {
    const packKey =
      typeof session.metadata?.pack_key === "string"
        ? session.metadata.pack_key
        : null;
    const tokensRaw =
      typeof session.metadata?.tokens === "string"
        ? session.metadata.tokens
        : null;
    const tokens = tokensRaw ? Number.parseInt(tokensRaw, 10) : NaN;
    if (!packKey || !Number.isFinite(tokens) || tokens <= 0) return;

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);

    await grantTokens({
      userId,
      amount: tokens,
      type: "top_up_purchase",
      description: `Top-up: ${packKey}`,
      stripeEventId: event.id,
      metadata: {
        pack_key: packKey,
        checkout_session_id: session.id,
        stripe_payment_intent_id: paymentIntentId,
      },
      client: supabase,
    });
  }
}

function formatLongDate(value: string | null): string | null {
  if (!value) return null;
  // `value` always comes from `timestampToIso`, which returns null or a
  // well-formed ISO string, so we don't need to defend against parse errors.
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Detects subscription lifecycle transitions (cancel / resume / downgrade)
 * by comparing the previous DB row to the freshly synced Stripe state, and
 * writes a 0-amount audit row to `token_transactions` so the Recent
 * Activity feed surfaces them. Each transition uses a per-transition
 * suffix on the Stripe event id (e.g. `evt_xxx::canceled`) for
 * idempotency, so a single Stripe event can fire multiple transition rows
 * if needed and replays never duplicate.
 */
async function recordSubscriptionTransitions(params: {
  event:
    | Stripe.CustomerSubscriptionUpdatedEvent
    | Stripe.CustomerSubscriptionCreatedEvent
    | Stripe.CustomerSubscriptionDeletedEvent;
  previous: {
    plan_key: string | null;
    cancel_at_period_end: boolean | null;
    current_period_end: string | null;
  } | null;
  ctx: { userId: string; planKey: string };
  stripeSub: Stripe.Subscription;
  client: Client;
}): Promise<void> {
  const { event, previous, ctx, stripeSub, client } = params;

  const wasCanceling = previous?.cancel_at_period_end ?? false;
  const isCanceling = isScheduledToCancel(stripeSub);
  const item = stripeSub.items.data[0];
  const periodEndIso = timestampToIso(item?.current_period_end);
  const periodEndLabel = formatLongDate(periodEndIso);

  if (!wasCanceling && isCanceling) {
    await recordSubscriptionEvent({
      userId: ctx.userId,
      type: "subscription_canceled",
      description: periodEndLabel
        ? `Subscription scheduled to end on ${periodEndLabel}`
        : "Subscription scheduled for cancellation",
      stripeEventId: `${event.id}::canceled`,
      metadata: {
        stripe_subscription_id: stripeSub.id,
        plan_key: ctx.planKey,
        period_end: periodEndIso,
        stripe_event_id: event.id,
      },
      client,
    });
  } else if (wasCanceling && !isCanceling) {
    await recordSubscriptionEvent({
      userId: ctx.userId,
      type: "subscription_resumed",
      description: periodEndLabel
        ? `Subscription resumed — renews on ${periodEndLabel}`
        : "Subscription resumed",
      stripeEventId: `${event.id}::resumed`,
      metadata: {
        stripe_subscription_id: stripeSub.id,
        plan_key: ctx.planKey,
        period_end: periodEndIso,
        stripe_event_id: event.id,
      },
      client,
    });
  }

  // Plan changed AND new tier has fewer monthly tokens → downgrade.
  // Upgrades are already surfaced via the upgrade-proration grant row, no
  // need to log them twice.
  const previousPlanKey = previous?.plan_key ?? null;
  if (previousPlanKey && previousPlanKey !== ctx.planKey) {
    const [fromPlan, toPlan] = await Promise.all([
      getPlanByKey(previousPlanKey, client),
      getPlanByKey(ctx.planKey, client),
    ]);
    if (fromPlan && toPlan && toPlan.monthly_tokens < fromPlan.monthly_tokens) {
      await recordSubscriptionEvent({
        userId: ctx.userId,
        type: "plan_downgraded",
        description: `Plan changed from ${fromPlan.name} to ${toPlan.name}`,
        stripeEventId: `${event.id}::downgraded`,
        metadata: {
          stripe_subscription_id: stripeSub.id,
          from_plan_key: fromPlan.key,
          to_plan_key: toPlan.key,
          stripe_event_id: event.id,
        },
        client,
      });
    }
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
  const stripeSub = event.data.object;

  // Read the existing row BEFORE we upsert, so we can detect transitions.
  const { data: previous } = await supabase
    .from("subscriptions")
    .select("plan_key, cancel_at_period_end, current_period_end")
    .eq("stripe_subscription_id", stripeSub.id)
    .maybeSingle();

  const ctx = await syncSubscriptionFromStripe({
    stripeSub,
    client: supabase,
  });
  if (!ctx) return;

  await recordSubscriptionTransitions({
    event,
    previous,
    ctx,
    stripeSub,
    client: supabase,
  });
}

/**
 * Returns the most recent positive subscription_grant for a user/sub. We use
 * it as the baseline when computing the token delta for a mid-cycle plan
 * change — the prior cycle's grant amount tells us how many tokens the user
 * already received on this subscription.
 */
async function findMostRecentSubscriptionGrant(
  userId: string,
  subscriptionId: string,
  client: Client,
): Promise<{ planKey: string | null; cycleTokens: number } | null> {
  const { data, error } = await client
    .from("token_transactions")
    .select("amount, metadata")
    .eq("user_id", userId)
    .eq("type", "subscription_grant")
    .filter("metadata->>stripe_subscription_id", "eq", subscriptionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const planKey = typeof meta.plan_key === "string" ? meta.plan_key : null;
  const cycleTokens = typeof data.amount === "number" ? data.amount : 0;
  return { planKey, cycleTokens };
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

  // Two billing_reasons drive token grants. Other reasons (subscription_create,
  // manual, threshold, upcoming) are handled elsewhere or ignored.
  //   - subscription_cycle  → renewal at start of period, grant the full tier.
  //   - subscription_update → mid-cycle plan change proration; grant the
  //     positive token delta for upgrades, skip for downgrades.
  if (
    invoice.billing_reason !== "subscription_cycle" &&
    invoice.billing_reason !== "subscription_update"
  ) {
    return;
  }

  const subscriptionId = extractSubscriptionIdFromInvoice(invoice);
  if (!subscriptionId || !options.retrieveSubscription) return;

  const stripeSub = await options.retrieveSubscription(subscriptionId);
  const ctx = await syncSubscriptionFromStripe({ stripeSub, client: supabase });
  if (!ctx) return;

  const plan = await getPlanByKey(ctx.planKey, supabase);
  if (!plan) return;

  const interval = getSubscriptionInterval(stripeSub);
  const newCycleTokens = tokensForCycle(plan, stripeSub);
  const cadence = interval === "year" ? "annual" : "monthly";

  if (invoice.billing_reason === "subscription_update") {
    // Compare against the previous cycle's grant on this subscription. If the
    // user upgraded, the new tier grants more — credit the difference. If it's
    // a same-tier change (e.g. monthly→monthly cadence flip with same plan)
    // or a downgrade, skip the grant entirely so we never deduct.
    const previous = await findMostRecentSubscriptionGrant(
      ctx.userId,
      stripeSub.id,
      supabase,
    );
    const previousCycleTokens = previous?.cycleTokens ?? 0;
    const delta = newCycleTokens - previousCycleTokens;
    if (delta <= 0) return;

    const formatted = new Intl.NumberFormat("en-US").format(delta);
    const cadenceSuffix = interval === "year" ? " (annual)" : "";
    await grantTokens({
      userId: ctx.userId,
      amount: delta,
      type: "subscription_grant",
      description: `Upgraded to ${plan.name}${cadenceSuffix} — ${formatted} tokens added`,
      stripeEventId: event.id,
      metadata: {
        stripe_subscription_id: stripeSub.id,
        stripe_invoice_id: invoice.id,
        plan_key: plan.key,
        interval: interval ?? "month",
        grant_kind: "upgrade_proration",
        previous_plan_key: previous?.planKey ?? null,
        previous_cycle_tokens: previousCycleTokens,
        new_cycle_tokens: newCycleTokens,
      },
      client: supabase,
    });
    return;
  }

  await grantTokens({
    userId: ctx.userId,
    amount: newCycleTokens,
    type: "subscription_grant",
    description: `${plan.name} plan — ${cadence} renewal`,
    stripeEventId: event.id,
    metadata: {
      stripe_subscription_id: stripeSub.id,
      stripe_invoice_id: invoice.id,
      plan_key: plan.key,
      interval: interval ?? "month",
    },
    client: supabase,
  });
}

/**
 * Looks up the user that owns a Stripe customer by walking
 * `stripe_customers.stripe_customer_id`.
 */
async function findUserIdForStripeCustomer(
  customerId: string,
  client: Client,
): Promise<string | null> {
  const { data, error } = await client
    .from("stripe_customers")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error) throw error;
  return data?.user_id ?? null;
}

/**
 * Sums all positive grants on `token_transactions` whose metadata links them
 * to the given Stripe object id (invoice or payment intent).
 */
async function sumGrantsByMetadataKey(params: {
  userId: string;
  metadataKey: "stripe_invoice_id" | "stripe_payment_intent_id";
  metadataValue: string;
  client: Client;
}): Promise<number> {
  const { data, error } = await params.client
    .from("token_transactions")
    .select("amount")
    .eq("user_id", params.userId)
    .gt("amount", 0)
    .filter(`metadata->>${params.metadataKey}`, "eq", params.metadataValue);

  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + (row.amount ?? 0), 0);
}

/**
 * Calculates how many tokens to revoke for a refund/chargeback. The policy is
 * "revoke proportional to the refunded amount" — for a full refund this
 * removes everything that was granted by the original charge; for a partial
 * refund it removes the same fraction.
 */
function tokensToRevoke(params: {
  totalGranted: number;
  amountRefunded: number;
  amountOriginal: number;
}): number {
  if (params.amountOriginal <= 0 || params.totalGranted <= 0) return 0;
  const proportion = Math.min(1, params.amountRefunded / params.amountOriginal);
  return Math.ceil(params.totalGranted * proportion);
}

/**
 * `Charge.invoice` is deprecated in the current Stripe SDK types but the field
 * still ships on the API for subscription-driven charges. Read it via an
 * `unknown` cast — same pattern used in `handleInvoicePaymentSucceeded`.
 */
function extractInvoiceIdFromCharge(charge: Stripe.Charge): string | null {
  const invoice = (
    charge as unknown as { invoice?: string | { id: string } | null }
  ).invoice;
  if (typeof invoice === "string") return invoice;
  if (invoice && typeof invoice === "object" && "id" in invoice)
    return invoice.id;
  return null;
}

/**
 * Reverses a charge by revoking the tokens granted from the underlying
 * invoice (subscription) or payment intent (top-up). Idempotent on event id.
 */
export async function handleChargeRefunded(
  event: Stripe.ChargeRefundedEvent,
  options: { client?: Client } = {},
): Promise<void> {
  const supabase = options.client ?? createAdminClient();
  const charge = event.data.object;

  const customerId =
    typeof charge.customer === "string"
      ? charge.customer
      : (charge.customer?.id ?? null);
  if (!customerId) return;

  const userId = await findUserIdForStripeCustomer(customerId, supabase);
  if (!userId) return;

  const invoiceId = extractInvoiceIdFromCharge(charge);
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : (charge.payment_intent?.id ?? null);

  let totalGranted = 0;
  if (invoiceId) {
    totalGranted = await sumGrantsByMetadataKey({
      userId,
      metadataKey: "stripe_invoice_id",
      metadataValue: invoiceId,
      client: supabase,
    });
  } else if (paymentIntentId) {
    totalGranted = await sumGrantsByMetadataKey({
      userId,
      metadataKey: "stripe_payment_intent_id",
      metadataValue: paymentIntentId,
      client: supabase,
    });
  }

  if (totalGranted <= 0) return;

  const amountRefunded = charge.amount_refunded ?? 0;
  const amountOriginal = charge.amount ?? 0;
  const revoke = tokensToRevoke({
    totalGranted,
    amountRefunded,
    amountOriginal,
  });
  if (revoke <= 0) return;

  await recordTokenRefund({
    userId,
    amount: revoke,
    description: `Refund for charge ${charge.id}`,
    stripeEventId: event.id,
    metadata: {
      stripe_charge_id: charge.id,
      stripe_invoice_id: invoiceId,
      stripe_payment_intent_id: paymentIntentId,
      stripe_event_type: event.type,
      total_granted: totalGranted,
      amount_refunded_cents: amountRefunded,
      amount_original_cents: amountOriginal,
    },
    client: supabase,
  });
}

/**
 * Reacts to a chargeback only when the dispute is *closed* and lost.
 * Open disputes are tracked but don't revoke tokens until resolved.
 */
export async function handleChargeDisputeClosed(
  event: Stripe.ChargeDisputeClosedEvent,
  options: {
    client?: Client;
    retrieveCharge?: (id: string) => Promise<Stripe.Charge>;
  } = {},
): Promise<void> {
  const supabase = options.client ?? createAdminClient();
  const dispute = event.data.object;

  if (dispute.status !== "lost") return;

  const chargeId =
    typeof dispute.charge === "string"
      ? dispute.charge
      : (dispute.charge?.id ?? null);
  if (!chargeId || !options.retrieveCharge) return;

  const charge = await options.retrieveCharge(chargeId);

  const customerId =
    typeof charge.customer === "string"
      ? charge.customer
      : (charge.customer?.id ?? null);
  if (!customerId) return;

  const userId = await findUserIdForStripeCustomer(customerId, supabase);
  if (!userId) return;

  const invoiceId = extractInvoiceIdFromCharge(charge);
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : (charge.payment_intent?.id ?? null);

  let totalGranted = 0;
  if (invoiceId) {
    totalGranted = await sumGrantsByMetadataKey({
      userId,
      metadataKey: "stripe_invoice_id",
      metadataValue: invoiceId,
      client: supabase,
    });
  } else if (paymentIntentId) {
    totalGranted = await sumGrantsByMetadataKey({
      userId,
      metadataKey: "stripe_payment_intent_id",
      metadataValue: paymentIntentId,
      client: supabase,
    });
  }

  if (totalGranted <= 0) return;

  await recordTokenRefund({
    userId,
    amount: totalGranted,
    description: `Chargeback lost for charge ${charge.id}`,
    stripeEventId: event.id,
    metadata: {
      stripe_charge_id: charge.id,
      stripe_dispute_id: dispute.id,
      stripe_invoice_id: invoiceId,
      stripe_payment_intent_id: paymentIntentId,
      stripe_event_type: event.type,
      total_granted: totalGranted,
      dispute_status: dispute.status,
    },
    client: supabase,
  });
}

export async function handleInvoicePaymentFailed(
  event: Stripe.InvoicePaymentFailedEvent,
  options: { client?: Client } = {},
): Promise<void> {
  const supabase = options.client ?? createAdminClient();
  const invoice = event.data.object;

  const subscriptionId = extractSubscriptionIdFromInvoice(invoice);
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
  retrieveCharge?: (id: string) => Promise<Stripe.Charge>;
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
    case "charge.refunded":
      await handleChargeRefunded(event, options);
      break;
    case "charge.dispute.closed":
      await handleChargeDisputeClosed(event, options);
      break;
    default:
      break;
  }
}
