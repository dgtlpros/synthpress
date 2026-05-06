import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/atoms/Card";
import {
  PlanBadge,
  type SubscriptionStatus,
} from "@/components/atoms/PlanBadge";
import { PriceTag } from "@/components/atoms/PriceTag";

export type SubscriptionInterval = "month" | "year";

export interface SubscriptionStatusCardProps {
  planName: string;
  planDescription?: string;
  /** The price for the current billing cycle in cents (monthly or annual). */
  priceCents?: number;
  /** Cadence the user is currently being billed at. Defaults to "month". */
  interval?: SubscriptionInterval;
  status: SubscriptionStatus;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  actions?: ReactNode;
  className?: string;
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function SubscriptionStatusCard({
  planName,
  planDescription,
  priceCents,
  interval = "month",
  status,
  currentPeriodEnd,
  cancelAtPeriodEnd = false,
  actions,
  className,
}: SubscriptionStatusCardProps) {
  const renewalDate = formatDate(currentPeriodEnd);
  const isFree = status === "free";
  // When a paid sub is scheduled to cancel, render the badge as "Canceling"
  // so the state is visible at a glance. The underlying Stripe status is
  // still active until the period ends.
  const effectiveStatus: SubscriptionStatus =
    cancelAtPeriodEnd && (status === "active" || status === "trialing")
      ? "canceling"
      : status;

  const isAnnual = interval === "year";
  const period = isAnnual ? "/yr" : "/mo";
  const cadenceLabel = isAnnual ? "Billed annually" : "Billed monthly";

  let footnote: string | null = null;
  if (!isFree && renewalDate) {
    if (cancelAtPeriodEnd) {
      footnote = `Subscription ends on ${renewalDate}.`;
    } else {
      footnote = isAnnual
        ? `Renews annually on ${renewalDate}.`
        : `Renews on ${renewalDate}.`;
    }
  } else if (status === "canceled") {
    footnote = "Subscription canceled.";
  } else if (isFree) {
    footnote =
      "You're on the free plan. Subscribe to get monthly synth tokens.";
  }

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Subscription</CardTitle>
            {planDescription && (
              <CardDescription>{planDescription}</CardDescription>
            )}
          </div>
          <PlanBadge planName={planName} status={effectiveStatus} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!isFree && priceCents !== undefined && (
          <div className="space-y-1">
            <PriceTag cents={priceCents} period={period} size="lg" />
            <p className="text-xs uppercase tracking-wide text-muted">
              {cadenceLabel}
            </p>
          </div>
        )}
        {footnote && <p className="text-sm text-muted">{footnote}</p>}
      </CardContent>

      {actions && <CardFooter className="gap-3">{actions}</CardFooter>}
    </Card>
  );
}
