import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const variantStyles = {
  neutral: "bg-surface-hover text-foreground border border-border",
  brand:
    "bg-gradient-accent text-white border-0 shadow-[var(--sp-shadow-sm)] hover:shadow-[var(--sp-shadow-md)] hover:brightness-110",
  warning:
    "bg-warning/10 text-warning border border-warning/30 shadow-[var(--sp-shadow-sm)]",
  lime: "bg-gradient-lime text-brand-navy border-0 shadow-[var(--sp-shadow-sm)] hover:shadow-[var(--sp-shadow-lime)] hover:brightness-110",
} as const;

const sizeStyles = {
  sm: { wrapper: "gap-1 px-2 py-0.5 text-[11px]", icon: "h-3 w-3" },
  md: { wrapper: "gap-1.5 px-2.5 py-1 text-xs", icon: "h-3.5 w-3.5" },
  lg: { wrapper: "gap-2 px-3 py-1.5 text-sm", icon: "h-4 w-4" },
} as const;

export type TokenBadgeVariant = keyof typeof variantStyles;
export type TokenBadgeSize = keyof typeof sizeStyles;

export interface TokenBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  balance: number;
  compact?: boolean;
  variant?: TokenBadgeVariant;
  size?: TokenBadgeSize;
}

const formatter = new Intl.NumberFormat("en-US");

export function TokenBadge({
  balance,
  compact = false,
  variant = "lime",
  size = "md",
  className,
  ...props
}: TokenBadgeProps) {
  const formatted = formatter.format(balance);
  const label = compact
    ? formatted
    : `${formatted} ${balance === 1 ? "token" : "tokens"}`;
  const sizing = sizeStyles[size];

  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold rounded-[var(--sp-radius-full)] transition-all",
        sizing.wrapper,
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      <svg
        viewBox="0 0 16 16"
        className={cn("flex-shrink-0", sizing.icon)}
        fill="none"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8 4.5v7M5.5 6.5l2.5-2 2.5 2M5.5 9.5l2.5 2 2.5-2"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="tabular-nums">{label}</span>
    </span>
  );
}
