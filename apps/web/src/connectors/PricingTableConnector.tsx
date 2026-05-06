"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { PricingCard } from "@/components/molecules/PricingCard";
import { SegmentedControl } from "@/components/atoms/SegmentedControl";

const formatter = new Intl.NumberFormat("en-US");

export type BillingInterval = "month" | "year";

export interface PricingTablePlan {
  key: string;
  name: string;
  description: string;
  monthlyPriceCents: number;
  annualPriceCents: number | null;
  features: string[];
  isPopular: boolean;
}

export interface PricingTableConnectorProps {
  plans: PricingTablePlan[];
  authed: boolean;
  className?: string;
}

function dollarsLabel(cents: number) {
  return `$${formatter.format(Math.floor(cents / 100))}`;
}

function checkoutHref(
  planKey: string,
  interval: BillingInterval,
  authed: boolean,
) {
  const params = new URLSearchParams({ plan: planKey });
  if (interval === "year") params.set("interval", "year");
  const target = `/checkout?${params.toString()}`;
  if (authed) return target;
  return `/signup?next=${encodeURIComponent(target)}`;
}

export function PricingTableConnector({
  plans,
  authed,
  className,
}: PricingTableConnectorProps) {
  const [interval, setInterval] = useState<BillingInterval>("month");

  const hasAnyAnnual = plans.some((p) => p.annualPriceCents !== null);

  return (
    <div className={cn("space-y-10", className)}>
      {hasAnyAnnual && (
        <div className="flex justify-center">
          <SegmentedControl
            ariaLabel="Billing interval"
            value={interval}
            onChange={setInterval}
            options={[
              { value: "month", label: "Monthly" },
              { value: "year", label: "Annual", badge: "2 months free" },
            ]}
          />
        </div>
      )}

      <div className="grid items-start gap-8 sm:grid-cols-3">
        {plans.map((plan) => {
          const usingAnnual =
            interval === "year" && plan.annualPriceCents !== null;
          // `usingAnnual` already guarantees `annualPriceCents` is non-null,
          // so the assertion here is type-safe and removes a dead-code branch.
          const cents = usingAnnual
            ? (plan.annualPriceCents as number)
            : plan.monthlyPriceCents;
          const periodLabel = usingAnnual ? "/yr" : "/mo";
          return (
            <PricingCard
              key={plan.key}
              name={plan.name}
              price={dollarsLabel(cents)}
              period={periodLabel}
              description={plan.description}
              features={plan.features}
              popular={plan.isPopular}
              ctaLabel={authed ? "Subscribe" : "Get Started"}
              ctaHref={checkoutHref(
                plan.key,
                usingAnnual ? "year" : "month",
                authed,
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
