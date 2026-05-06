import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface PriceTagProps extends HTMLAttributes<HTMLDivElement> {
  cents: number;
  period?: string;
  currency?: string;
  size?: "sm" | "md" | "lg";
}

const sizeStyles = {
  sm: { amount: "text-xl", period: "text-xs" },
  md: { amount: "text-2xl", period: "text-sm" },
  lg: { amount: "text-4xl", period: "text-sm" },
} as const;

function formatAmount(cents: number, currency: string) {
  const dollars = cents / 100;
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: dollars % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(dollars);
}

export function PriceTag({
  cents,
  period,
  currency = "USD",
  size = "md",
  className,
  ...props
}: PriceTagProps) {
  const styles = sizeStyles[size];
  return (
    <div
      className={cn("inline-flex items-baseline gap-1", className)}
      {...props}
    >
      <span className={cn("font-bold text-foreground", styles.amount)}>
        {formatAmount(cents, currency)}
      </span>
      {period && (
        <span className={cn("text-muted", styles.period)}>{period}</span>
      )}
    </div>
  );
}
