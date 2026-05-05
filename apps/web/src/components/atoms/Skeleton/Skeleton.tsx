import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const variantStyles = {
  rect: "rounded-[var(--sp-radius-md)]",
  pill: "rounded-[var(--sp-radius-full)]",
  circle: "rounded-full",
} as const;

export type SkeletonVariant = keyof typeof variantStyles;

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SkeletonVariant;
}

export function Skeleton({
  variant = "rect",
  className,
  ...props
}: SkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={cn(
        "animate-pulse bg-surface-hover",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}
