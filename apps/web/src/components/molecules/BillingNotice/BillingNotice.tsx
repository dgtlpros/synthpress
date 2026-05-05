import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const variantConfig = {
  success: {
    container: "border-success/30 bg-success/10",
    iconBg: "bg-success/20 text-success",
    title: "text-foreground",
  },
  info: {
    container: "border-brand-blue/30 bg-brand-blue/10",
    iconBg: "bg-brand-blue/20 text-brand-blue",
    title: "text-foreground",
  },
  warning: {
    container: "border-warning/40 bg-warning/10",
    iconBg: "bg-warning/20 text-warning",
    title: "text-foreground",
  },
  danger: {
    container: "border-error/40 bg-error/10",
    iconBg: "bg-error/20 text-error",
    title: "text-foreground",
  },
} as const;

export type BillingNoticeVariant = keyof typeof variantConfig;

export interface BillingNoticeProps {
  variant?: BillingNoticeVariant;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function BillingNotice({
  variant = "info",
  title,
  description,
  action,
  icon,
  className,
}: BillingNoticeProps) {
  const config = variantConfig[variant];
  return (
    <section
      role="status"
      data-testid="billing-notice"
      data-variant={variant}
      className={cn(
        "flex flex-col gap-4 rounded-[var(--sp-radius-xl)] border p-5 sm:flex-row sm:items-center sm:p-6",
        config.container,
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          config.iconBg,
        )}
      >
        {icon ?? <DefaultIcon variant={variant} />}
      </div>
      <div className="flex-1 space-y-1">
        <h2 className={cn("text-base font-semibold sm:text-lg", config.title)}>{title}</h2>
        {description && (
          <p className="text-sm text-muted leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0 sm:self-center">{action}</div>}
    </section>
  );
}

function DefaultIcon({ variant }: { variant: BillingNoticeVariant }) {
  if (variant === "success") {
    return (
      <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none">
        <path
          d="M5 10.5l3.5 3.5L15 7"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (variant === "danger") {
    return (
      <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none">
        <path
          d="M10 5v6"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <circle cx="10" cy="14.5" r="1" fill="currentColor" />
        <circle
          cx="10"
          cy="10"
          r="8"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  // info + warning share the "i" icon
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 9v5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="10" cy="6.5" r="1" fill="currentColor" />
    </svg>
  );
}
