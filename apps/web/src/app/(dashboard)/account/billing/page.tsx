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

  const packs = (packsResult.data ?? []).map((pack) => ({
    key: pack.key,
    name: pack.name,
    description: pack.description,
    tokens: pack.tokens,
    priceCents: pack.price_cents,
    ctaHref: `/checkout?pack=${pack.key}`,
  }));

  const subscriptionActions = plan ? (
    <BillingActionsConnector />
  ) : (
    <NextLink
      href="/pricing"
      className="inline-flex h-10 items-center justify-center rounded-[var(--sp-radius-lg)] bg-gradient-accent px-4 text-sm font-medium text-white shadow-sm transition-all hover:brightness-110"
    >
      Choose a plan
    </NextLink>
  );

  return (
    <div className="space-y-8">
      <div>
        <NextLink href="/account" className="text-sm text-muted hover:text-foreground transition-colors">
          ← Back to account
        </NextLink>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Billing</h1>
        <p className="mt-1 text-sm text-muted">Manage your plan, synth tokens, and recent activity.</p>
      </div>

      <BillingSection
        plan={
          plan
            ? {
                name: plan.name,
                description: plan.description,
                monthlyPriceCents: plan.monthly_price_cents,
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
    </div>
  );
}
