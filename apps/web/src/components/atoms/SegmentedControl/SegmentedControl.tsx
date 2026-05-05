import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SegmentedControlOption<TValue extends string> {
  value: TValue;
  label: ReactNode;
  badge?: ReactNode;
}

export interface SegmentedControlProps<TValue extends string> {
  options: SegmentedControlOption<TValue>[];
  value: TValue;
  onChange: (next: TValue) => void;
  ariaLabel?: string;
  className?: string;
}

export function SegmentedControl<TValue extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<TValue>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--sp-radius-full)] border border-border bg-surface p-1 shadow-[var(--sp-shadow-sm)]",
        className,
      )}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-2 rounded-[var(--sp-radius-full)] px-4 py-1.5 text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
              isActive
                ? "bg-gradient-accent text-white shadow-sm"
                : "text-muted hover:text-foreground",
            )}
          >
            <span>{option.label}</span>
            {option.badge && (
              <span
                className={cn(
                  "inline-flex items-center rounded-[var(--sp-radius-full)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-success/15 text-success",
                )}
              >
                {option.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
