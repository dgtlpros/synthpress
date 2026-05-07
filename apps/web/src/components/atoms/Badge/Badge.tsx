import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const variantStyles = {
  default: "bg-surface-hover text-foreground border border-border",
  success: "bg-success/10 text-success border border-success/20",
  warning: "bg-warning/10 text-warning border border-warning/20",
  error: "bg-error/10 text-error border border-error/20",
  brand: "bg-gradient-accent text-white border-0",
  lime: "bg-brand-lime/10 text-brand-lime-dark border border-brand-lime/30",
} as const;

const sizeStyles = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-0.5 text-xs",
  lg: "px-3 py-1 text-sm",
} as const;

export type BadgeVariant = keyof typeof variantStyles;
export type BadgeSize = keyof typeof sizeStyles;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

export function Badge({
  variant = "default",
  size = "md",
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-[var(--sp-radius-full)]",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
