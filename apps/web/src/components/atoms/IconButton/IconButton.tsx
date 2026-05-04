import { type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const sizeStyles = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
} as const;

const variantStyles = {
  default: "bg-surface border border-border hover:bg-surface-hover hover:border-border-hover text-foreground",
  ghost: "bg-transparent hover:bg-surface-hover text-foreground",
  brand: "bg-gradient-accent text-white shadow-sm hover:brightness-110",
} as const;

export type IconButtonSize = keyof typeof sizeStyles;
export type IconButtonVariant = keyof typeof variantStyles;

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  label: string;
}

export function IconButton({ size = "md", variant = "default", label, className, children, ...props }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center rounded-[var(--sp-radius-lg)] transition-all duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
        variantStyles[variant],
        sizeStyles[size],
        props.disabled && "opacity-50 pointer-events-none",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
