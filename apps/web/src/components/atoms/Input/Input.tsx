import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error, className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-[var(--sp-radius-lg)] border bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground shadow-sm transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue",
          error
            ? "border-error focus:ring-error/30 focus:border-error"
            : "border-border hover:border-border-hover",
          props.disabled && "opacity-50 cursor-not-allowed",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
