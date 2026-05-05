import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TokenBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  balance: number;
  compact?: boolean;
  variant?: "neutral" | "brand" | "warning";
}

const variantStyles = {
  neutral: "bg-surface-hover text-foreground border border-border",
  brand: "bg-gradient-accent text-white border-0",
  warning: "bg-warning/10 text-warning border border-warning/20",
} as const;

export type TokenBadgeVariant = keyof typeof variantStyles;

const formatter = new Intl.NumberFormat("en-US");

export function TokenBadge({
  balance,
  compact = false,
  variant = "neutral",
  className,
  ...props
}: TokenBadgeProps) {
  const formatted = formatter.format(balance);
  const label = compact ? formatted : `${formatted} ${balance === 1 ? "token" : "tokens"}`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--sp-radius-full)] px-2.5 py-0.5 text-xs font-medium",
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      <svg
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5"
        fill="currentColor"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.25" fill="none" />
        <circle cx="8" cy="8" r="2.5" />
      </svg>
      <span>{label}</span>
    </span>
  );
}
