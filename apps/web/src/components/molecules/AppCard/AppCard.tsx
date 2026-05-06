import type { ReactNode } from "react";
import NextLink from "next/link";
import { cn } from "@/lib/cn";

export interface AppCardProps {
  title: string;
  description?: string;
  href?: string;
  badge?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function AppCard({
  title,
  description,
  href,
  badge,
  icon,
  disabled = false,
  className,
}: AppCardProps) {
  const isInteractive = Boolean(href) && !disabled;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? (
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--sp-radius-md)] bg-surface-hover text-lg"
              aria-hidden
            >
              {icon}
            </span>
          ) : null}
          <h3 className="truncate text-sm font-semibold text-foreground">
            {title}
          </h3>
        </div>
        {badge ? <span className="shrink-0">{badge}</span> : null}
      </div>
      {description ? (
        <p className="mt-2 text-xs leading-relaxed text-muted">{description}</p>
      ) : null}
    </>
  );

  const shellClass = cn(
    "rounded-[var(--sp-radius-xl)] border p-4 text-left transition-colors",
    isInteractive &&
      "border-border bg-surface shadow-[var(--sp-shadow-sm)] hover:border-border-hover hover:bg-surface-hover hover:shadow-[var(--sp-shadow-md)]",
    !isInteractive &&
      "cursor-not-allowed border-border/60 bg-surface/80 text-muted",
    className,
  );

  if (isInteractive && href) {
    return (
      <NextLink
        href={href}
        className={cn(
          shellClass,
          "block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
        )}
      >
        {body}
      </NextLink>
    );
  }

  return (
    <div className={shellClass} aria-disabled={disabled || !href}>
      {body}
    </div>
  );
}
