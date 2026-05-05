import "server-only";
import Stripe from "stripe";

let cachedStripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (cachedStripe) return cachedStripe;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  cachedStripe = new Stripe(key, { typescript: true });
  return cachedStripe;
}

export function resetStripeForTesting() {
  cachedStripe = null;
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function findOrCreateCustomer(params: {
  email: string;
  userId: string;
  existingCustomerId?: string;
}): Promise<string> {
  const stripe = getStripe();

  if (params.existingCustomerId) {
    return params.existingCustomerId;
  }

  const customer = await stripe.customers.create({
    email: params.email,
    metadata: { supabase_user_id: params.userId },
  });

  return customer.id;
}

export async function createSubscriptionCheckoutSession(params: {
  customerId: string;
  priceId: string;
  userId: string;
  planKey: string;
  interval?: "month" | "year";
  returnPath?: string;
}): Promise<{ id: string; clientSecret: string }> {
  const stripe = getStripe();
  const returnPath = params.returnPath ?? "/checkout/return?session_id={CHECKOUT_SESSION_ID}";
  const interval = params.interval ?? "month";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    ui_mode: "embedded_page",
    customer: params.customerId,
    line_items: [{ price: params.priceId, quantity: 1 }],
    return_url: `${getAppUrl()}${returnPath}`,
    metadata: {
      supabase_user_id: params.userId,
      plan_key: params.planKey,
      interval,
      checkout_kind: "subscription",
    },
    subscription_data: {
      metadata: {
        supabase_user_id: params.userId,
        plan_key: params.planKey,
        interval,
      },
    },
  });

  if (!session.client_secret) {
    throw new Error("Stripe did not return a client_secret for the embedded session");
  }

  return { id: session.id, clientSecret: session.client_secret };
}

export async function createTopUpCheckoutSession(params: {
  customerId: string;
  priceId: string;
  userId: string;
  packKey: string;
  tokens: number;
  returnPath?: string;
}): Promise<{ id: string; clientSecret: string }> {
  const stripe = getStripe();
  const returnPath = params.returnPath ?? "/checkout/return?session_id={CHECKOUT_SESSION_ID}";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    ui_mode: "embedded_page",
    customer: params.customerId,
    line_items: [{ price: params.priceId, quantity: 1 }],
    return_url: `${getAppUrl()}${returnPath}`,
    metadata: {
      supabase_user_id: params.userId,
      pack_key: params.packKey,
      tokens: String(params.tokens),
      checkout_kind: "top_up",
    },
    payment_intent_data: {
      metadata: {
        supabase_user_id: params.userId,
        pack_key: params.packKey,
        tokens: String(params.tokens),
      },
    },
  });

  if (!session.client_secret) {
    throw new Error("Stripe did not return a client_secret for the embedded session");
  }

  return { id: session.id, clientSecret: session.client_secret };
}

export async function createPortalSession(params: {
  customerId: string;
  returnPath?: string;
}): Promise<{ url: string }> {
  const stripe = getStripe();
  const returnPath = params.returnPath ?? "/account/billing";

  const session = await stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: `${getAppUrl()}${returnPath}`,
  });

  return { url: session.url };
}

export async function retrieveCheckoutSession(sessionId: string) {
  const stripe = getStripe();
  return stripe.checkout.sessions.retrieve(sessionId);
}

export async function resumeSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });
}

export async function verifyWebhook(params: {
  rawBody: string;
  signature: string;
}): Promise<Stripe.Event> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }

  return stripe.webhooks.constructEventAsync(params.rawBody, params.signature, secret);
}
