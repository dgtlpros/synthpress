import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const variantStyles = {
  brand: "bg-gradient-accent",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  default: "bg-muted",
} as const;

const sizeStyles = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-2",
} as const;

export type ProgressBarVariant = keyof typeof variantStyles;
export type ProgressBarSize = keyof typeof sizeStyles;

export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * 0–100. Values outside the range are clamped. The bar's visual
   * width is clamped at 4 % minimum so a 1 % progress is still
   * visible (otherwise the bar looks empty).
   */
  value: number;
  variant?: ProgressBarVariant;
  size?: ProgressBarSize;
  /**
   * Accessible label for the progress meter. Defaults to a generic
   * "Progress" but every consumer should pass a more specific one
   * (e.g. "Article generation progress for 'How to launch a B2B blog'").
   */
  label?: string;
}

/**
 * Thin horizontal progress meter. Used by the global active-jobs
 * tray to show estimated completion for in-flight article generation
 * jobs. Pure / dumb — receives a percentage, draws the fill.
 */
export function ProgressBar({
  value,
  variant = "brand",
  size = "md",
  label = "Progress",
  className,
  ...props
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  // Visual floor: a 1–3 % bar reads as "broken / empty"; bump the
  // displayed width so even early progress is visible. The aria
  // value still reflects the true percentage so assistive tech
  // sees the right number.
  const visualWidth = clamped > 0 && clamped < 4 ? 4 : clamped;

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn(
        "w-full overflow-hidden rounded-[var(--sp-radius-full)] bg-surface-hover",
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "h-full rounded-[var(--sp-radius-full)] transition-[width] duration-500 ease-out",
          variantStyles[variant],
        )}
        style={{ width: `${visualWidth}%` }}
      />
    </div>
  );
}
