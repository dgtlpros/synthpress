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
  const returnPath =
    params.returnPath ?? "/checkout/return?session_id={CHECKOUT_SESSION_ID}";
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
    throw new Error(
      "Stripe did not return a client_secret for the embedded session",
    );
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
  const returnPath =
    params.returnPath ?? "/checkout/return?session_id={CHECKOUT_SESSION_ID}";

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
    throw new Error(
      "Stripe did not return a client_secret for the embedded session",
    );
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

export type InvoiceStatus =
  | "paid"
  | "open"
  | "void"
  | "uncollectible"
  | "draft"
  | "unknown";

export interface InvoiceListItem {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  amountPaid: number;
  amountDue: number;
  currency: string;
  createdAt: number;
  periodStart: number | null;
  periodEnd: number | null;
  description: string | null;
  pdfUrl: string | null;
  hostedUrl: string | null;
}

const INVOICE_STATUSES: ReadonlyArray<InvoiceStatus> = [
  "paid",
  "open",
  "void",
  "uncollectible",
  "draft",
];

function normalizeInvoiceStatus(
  status: string | null | undefined,
): InvoiceStatus {
  if (status && (INVOICE_STATUSES as readonly string[]).includes(status)) {
    return status as InvoiceStatus;
  }
  return "unknown";
}

/**
 * Returns the most recent invoices for a Stripe customer, mapped to a clean
 * DTO the UI can consume directly. We rely on Stripe-hosted PDFs
 * (`invoice.invoice_pdf`) and never render PDFs ourselves.
 */
export async function getCustomerInvoices(
  customerId: string,
  limit = 12,
): Promise<InvoiceListItem[]> {
  const stripe = getStripe();
  const list = await stripe.invoices.list({ customer: customerId, limit });

  return list.data.map((invoice) => ({
    id: invoice.id ?? "",
    number: invoice.number ?? null,
    status: normalizeInvoiceStatus(invoice.status),
    amountPaid: invoice.amount_paid ?? 0,
    amountDue: invoice.amount_due ?? 0,
    currency: invoice.currency ?? "usd",
    createdAt: invoice.created,
    periodStart: invoice.period_start ?? null,
    periodEnd: invoice.period_end ?? null,
    description: invoice.description ?? null,
    pdfUrl: invoice.invoice_pdf ?? null,
    hostedUrl: invoice.hosted_invoice_url ?? null,
  }));
}

/**
 * Reverses an end-of-period cancellation. Returns the updated subscription
 * object so callers can sync our DB without a second round-trip — important
 * because we want `/account/billing` to render the resumed state immediately
 * after the action returns instead of waiting on the Stripe webhook.
 */
export async function resumeSubscription(
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  return stripe.subscriptions.update(subscriptionId, {
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

  return stripe.webhooks.constructEventAsync(
    params.rawBody,
    params.signature,
    secret,
  );
}
