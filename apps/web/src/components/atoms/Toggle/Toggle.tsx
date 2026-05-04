import { type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}

export function Toggle({ checked = false, onChange, disabled, className, ...props }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-[var(--sp-radius-full)] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
        checked ? "bg-gradient-accent" : "bg-surface-active",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
      onClick={() => !disabled && onChange?.(!checked)}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-[var(--sp-radius-full)] bg-white shadow-md transition-transform duration-200",
          checked ? "translate-x-5.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
