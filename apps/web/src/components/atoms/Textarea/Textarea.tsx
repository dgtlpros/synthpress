import { type TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "min-h-[80px] w-full rounded-[var(--sp-radius-lg)] border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground shadow-sm transition-colors resize-y",
          "focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue",
          error ? "border-error focus:ring-error/30 focus:border-error" : "border-border hover:border-border-hover",
          props.disabled && "opacity-50 cursor-not-allowed",
          className,
        )}
        {...props}
      />
    );
  },
);

Textarea.displayName = "Textarea";
