import NextLink from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCurrentPlan,
  type Plan,
  type Subscription,
} from "@/services/billing-service";
import {
  getBalance,
  getRecentTransactions,
  type TokenTransaction,
} from "@/services/token-service";
import { BillingSection } from "@/components/organisms/BillingSection";
import { BillingNotice } from "@/components/molecules/BillingNotice";
import { BillingActionsConnector } from "@/connectors/BillingActionsConnector";
import type { SubscriptionStatus } from "@/components/atoms/PlanBadge";

export const dynamic = "force-dynamic";

const KNOWN_STATUSES: SubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
  "incomplete",
  "canceled",
  "unpaid",
  "paused",
  "free",
];

function normalizeStatus(status: string): SubscriptionStatus {
  return (KNOWN_STATUSES as string[]).includes(status)
    ? (status as SubscriptionStatus)
    : "active";
}

function formatLongDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

interface BillingPageNotice {
  variant: "success" | "info" | "warning" | "danger";
  title: string;
  description: string;
  actionMode: "manage" | "resume";
  actionLabel: string;
}

function computeBillingNotice(params: {
  planName: string | null;
  status: SubscriptionStatus | null;
  cancelAtPeriodEnd: boolean;
  periodEndIso: string | null;
}): BillingPageNotice | null {
  const periodEndLabel = formatLongDate(params.periodEndIso);
  const planName = params.planName ?? "Your plan";

  if (params.status === "past_due") {
    return {
      variant: "danger",
      title: "Your last payment failed",
      description:
        "Update your payment method to keep your subscription active. Stripe will automatically retry over the next few days.",
      actionMode: "manage",
      actionLabel: "Update payment method",
    };
  }

  if (params.status === "unpaid") {
    return {
      variant: "danger",
      title: "Subscription is unpaid",
      description:
        "Your subscription is on hold. Update your payment method to restore access.",
      actionMode: "manage",
      actionLabel: "Update payment method",
    };
  }

  if (params.status === "incomplete") {
    return {
      variant: "warning",
      title: "Subscription is pending payment",
      description:
        "Your initial payment hasn't completed. Try the checkout again or update your card.",
      actionMode: "manage",
      actionLabel: "Manage subscription",
    };
  }

  if (params.cancelAtPeriodEnd) {
    return {
      variant: "warning",
      title: periodEndLabel
        ? `${planName} is set to cancel on ${periodEndLabel}`
        : `${planName} is set to cancel`,
      description:
        "You'll keep access and your synth tokens until then. Resume anytime to continue your subscription.",
      actionMode: "resume",
      actionLabel: "Resume subscription",
    };
  }

  if (params.status === "paused") {
    return {
      variant: "warning",
      title: "Subscription paused",
      description: "Your subscription is paused. Manage it to resume billing.",
      actionMode: "manage",
      actionLabel: "Manage subscription",
    };
  }

  return null;
}

export default async function AccountBillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const admin = createAdminClient();

  const [current, balance, transactions, packsResult] = await Promise.all([
    getCurrentPlan(user.id, admin),
    getBalance(user.id, admin),
    getRecentTransactions(user.id, { limit: 10, client: admin }),
    admin.from("token_packs").select("*").order("sort_order"),
  ]);

  const plan: Plan | null = current?.plan ?? null;
  const subscription: Subscription | null = current?.subscription ?? null;

  // Derive the cadence (monthly vs annual) from the subscription's current
  // price id. Stripe sends `customer.subscription.updated` whenever a user
  // flips cadence in the Customer Portal, so this is always up to date.
  const interval: "month" | "year" =
    subscription &&
    plan?.stripe_annual_price_id &&
    subscription.stripe_price_id === plan.stripe_annual_price_id
      ? "year"
      : "month";

  // Pick the right price-cents column for the cadence the user is actually
  // on. Falls back to monthly_price_cents when there's no annual price yet
  // for this plan.
  const planPriceCents =
    interval === "year" && plan?.annual_price_cents
      ? plan.annual_price_cents
      : (plan?.monthly_price_cents ?? 0);

  const packs = (packsResult.data ?? []).map((pack) => ({
    key: pack.key,
    name: pack.name,
    description: pack.description,
    tokens: pack.tokens,
    priceCents: pack.price_cents,
    ctaHref: `/checkout?pack=${pack.key}`,
  }));

  let subscriptionActions: React.ReactNode;
  if (!plan) {
    subscriptionActions = (
      <NextLink
        href="/pricing"
        className="inline-flex h-10 items-center justify-center rounded-[var(--sp-radius-lg)] bg-gradient-accent px-4 text-sm font-medium text-white shadow-sm transition-all hover:brightness-110"
      >
        Choose a plan
      </NextLink>
    );
  } else if (subscription?.cancel_at_period_end) {
    subscriptionActions = (
      <>
        <BillingActionsConnector mode="resume" />
        <BillingActionsConnector mode="manage" variant="secondary" />
      </>
    );
  } else {
    subscriptionActions = <BillingActionsConnector />;
  }

  const notice = computeBillingNotice({
    planName: plan?.name ?? null,
    status: subscription ? normalizeStatus(subscription.status) : null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
    periodEndIso: subscription?.current_period_end ?? null,
  });

  return (
    <div className="space-y-8">
      <div>
        <NextLink href="/account" className="text-sm text-muted hover:text-foreground transition-colors">
          ← Back to account
        </NextLink>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Billing</h1>
        <p className="mt-1 text-sm text-muted">Manage your plan, synth tokens, and recent activity.</p>
      </div>

      {notice && (
        <BillingNotice
          variant={notice.variant}
          title={notice.title}
          description={notice.description}
          action={
            <BillingActionsConnector
              mode={notice.actionMode}
              label={notice.actionLabel}
              variant={notice.variant === "warning" || notice.variant === "danger" ? "primary" : "secondary"}
            />
          }
        />
      )}

      <BillingSection
        plan={
          plan
            ? {
                name: plan.name,
                description: plan.description,
                priceCents: planPriceCents,
                monthlyTokens: plan.monthly_tokens,
              }
            : null
        }
        subscription={
          subscription
            ? {
                status: normalizeStatus(subscription.status),
                currentPeriodEnd: subscription.current_period_end,
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                interval,
              }
            : null
        }
        balance={balance}
        transactions={(transactions as TokenTransaction[]).map((t) => ({
          id: t.id,
          amount: t.amount,
          type: t.type,
          description: t.description,
          created_at: t.created_at,
        }))}
        topUpPacks={packs}
        subscriptionActions={subscriptionActions}
      />

      <div className="rounded-[var(--sp-radius-xl)] border border-border bg-surface px-6 py-4 shadow-[var(--sp-shadow-sm)]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Billing history</h3>
            <p className="text-xs text-muted">
              Download PDF receipts for every charge.
            </p>
          </div>
          <NextLink
            href="/account/billing/invoices"
            className="inline-flex h-9 items-center justify-center rounded-[var(--sp-radius-md)] border border-border bg-surface px-4 text-sm font-medium text-foreground hover:bg-surface-hover transition-colors cursor-pointer"
          >
            View all invoices
          </NextLink>
        </div>
      </div>
    </div>
  );
}
