import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { SubscriptionStatusCard } from "@/components/molecules/SubscriptionStatusCard";
import { TokenBalanceCard } from "@/components/molecules/TokenBalanceCard";
import { TopUpCard } from "@/components/molecules/TopUpCard";
import type { SubscriptionStatus } from "@/components/atoms/PlanBadge";

const formatter = new Intl.NumberFormat("en-US");

export interface BillingSectionPlan {
  name: string;
  description?: string;
  monthlyPriceCents: number;
  monthlyTokens: number;
}

export interface BillingSectionSubscription {
  status: SubscriptionStatus;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}

export interface BillingSectionTransaction {
  id: string;
  amount: number;
  type: string;
  description: string | null;
  created_at: string;
}

export interface BillingSectionTopUpPack {
  key: string;
  name: string;
  description?: string;
  tokens: number;
  priceCents: number;
  ctaLabel?: string;
  ctaHref: string;
}

export interface BillingSectionProps {
  plan: BillingSectionPlan | null;
  subscription: BillingSectionSubscription | null;
  balance: number;
  transactions: BillingSectionTransaction[];
  topUpPacks: BillingSectionTopUpPack[];
  subscriptionActions?: ReactNode;
  className?: string;
}

const typeLabels: Record<string, string> = {
  signup_grant: "Welcome bonus",
  subscription_grant: "Subscription credit",
  top_up_purchase: "Top-up purchase",
  usage: "AI usage",
  refund: "Refund",
  adjustment: "Adjustment",
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatAmount(amount: number) {
  if (amount > 0) return `+${formatter.format(amount)}`;
  return `${formatter.format(amount)}`;
}

export function BillingSection({
  plan,
  subscription,
  balance,
  transactions,
  topUpPacks,
  subscriptionActions,
  className,
}: BillingSectionProps) {
  const status = subscription?.status ?? (plan ? "active" : "free");

  return (
    <div className={cn("space-y-8", className)}>
      <div className="grid gap-6 lg:grid-cols-2">
        <SubscriptionStatusCard
          planName={plan?.name ?? "Free"}
          planDescription={plan?.description}
          monthlyPriceCents={plan?.monthlyPriceCents}
          status={status}
          currentPeriodEnd={subscription?.currentPeriodEnd ?? null}
          cancelAtPeriodEnd={subscription?.cancelAtPeriodEnd}
          actions={subscriptionActions}
        />

        <TokenBalanceCard balance={balance} monthlyAllowance={plan?.monthlyTokens} />
      </div>

      {topUpPacks.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">One-time top-ups</h2>
            <p className="mt-1 text-sm text-muted">
              Buy synth tokens without changing your plan. Tokens never expire.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {topUpPacks.map((pack) => (
              <TopUpCard
                key={pack.key}
                name={pack.name}
                description={pack.description}
                tokens={pack.tokens}
                priceCents={pack.priceCents}
                cta={
                  <a
                    href={pack.ctaHref}
                    className="inline-flex h-10 w-full items-center justify-center rounded-[var(--sp-radius-lg)] bg-gradient-accent text-sm font-medium text-white shadow-sm transition-all hover:brightness-110"
                  >
                    {pack.ctaLabel ?? "Buy now"}
                  </a>
                }
              />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Recent activity</h2>

        {transactions.length === 0 ? (
          <p className="text-sm text-muted">No activity yet.</p>
        ) : (
          <div className="overflow-hidden rounded-[var(--sp-radius-xl)] border border-border bg-surface shadow-[var(--sp-shadow-sm)]">
            <table className="w-full text-sm">
              <thead className="bg-surface-hover text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-left font-medium">Description</th>
                  <th className="px-4 py-3 text-right font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="px-4 py-3 text-muted">{formatDate(tx.created_at)}</td>
                    <td className="px-4 py-3 text-foreground">
                      {typeLabels[tx.type] ?? tx.type}
                    </td>
                    <td className="px-4 py-3 text-muted">{tx.description ?? "—"}</td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right font-medium",
                        tx.amount > 0 ? "text-success" : "text-foreground",
                      )}
                    >
                      {formatAmount(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
