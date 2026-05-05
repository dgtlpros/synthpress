import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/atoms/Card";
import { PlanBadge, type SubscriptionStatus } from "@/components/atoms/PlanBadge";
import { PriceTag } from "@/components/atoms/PriceTag";

export interface SubscriptionStatusCardProps {
  planName: string;
  planDescription?: string;
  monthlyPriceCents?: number;
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
  monthlyPriceCents,
  status,
  currentPeriodEnd,
  cancelAtPeriodEnd = false,
  actions,
  className,
}: SubscriptionStatusCardProps) {
  const renewalDate = formatDate(currentPeriodEnd);
  const isFree = status === "free";

  let footnote: string | null = null;
  if (!isFree && renewalDate) {
    footnote = cancelAtPeriodEnd
      ? `Subscription ends on ${renewalDate}.`
      : `Renews on ${renewalDate}.`;
  } else if (status === "canceled") {
    footnote = "Subscription canceled.";
  } else if (isFree) {
    footnote = "You're on the free plan. Subscribe to get monthly synth tokens.";
  }

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Subscription</CardTitle>
            {planDescription && <CardDescription>{planDescription}</CardDescription>}
          </div>
          <PlanBadge planName={planName} status={status} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!isFree && monthlyPriceCents !== undefined && (
          <PriceTag cents={monthlyPriceCents} period="/mo" size="lg" />
        )}
        {footnote && <p className="text-sm text-muted">{footnote}</p>}
      </CardContent>

      {actions && <CardFooter className="gap-3">{actions}</CardFooter>}
    </Card>
  );
}
