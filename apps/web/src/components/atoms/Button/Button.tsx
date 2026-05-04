import { type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const variantStyles = {
  primary: "bg-gradient-accent text-white shadow-md hover:shadow-lg hover:brightness-110",
  secondary: "bg-surface text-foreground border border-border hover:bg-surface-hover hover:border-border-hover shadow-sm",
  ghost: "bg-transparent text-foreground hover:bg-surface-hover",
  danger: "bg-error text-white hover:brightness-110 shadow-sm",
} as const;

const sizeStyles = {
  sm: "h-8 px-3 text-xs rounded-[var(--sp-radius-md)]",
  md: "h-10 px-4 text-sm rounded-[var(--sp-radius-lg)]",
  lg: "h-12 px-6 text-base rounded-[var(--sp-radius-lg)]",
} as const;

export type ButtonVariant = keyof typeof variantStyles;
export type ButtonSize = keyof typeof sizeStyles;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue cursor-pointer",
        variantStyles[variant],
        sizeStyles[size],
        (disabled || loading) && "pointer-events-none opacity-50",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      data-testid="button-spinner"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
