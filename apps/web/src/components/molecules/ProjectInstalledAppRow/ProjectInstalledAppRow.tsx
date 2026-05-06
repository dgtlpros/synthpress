import NextLink from "next/link";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/atoms/Badge";

export interface ProjectInstalledAppRowProps {
  href: string;
  appKindLabel: string;
  title: string;
  subtitle: string;
  isActive: boolean;
  meta?: string | null;
  className?: string;
}

export function ProjectInstalledAppRow({
  href,
  appKindLabel,
  title,
  subtitle,
  isActive,
  meta,
  className,
}: ProjectInstalledAppRowProps) {
  return (
    <NextLink
      href={href}
      className={cn(
        "flex cursor-pointer items-center gap-4 rounded-[var(--sp-radius-lg)] border border-border bg-surface px-4 py-3 text-left shadow-sm transition-colors hover:border-border-hover hover:bg-surface-hover",
        className,
      )}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--sp-radius-md)] bg-surface-hover text-lg"
        aria-hidden
      >
        📝
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{appKindLabel}</span>
          <Badge variant={isActive ? "brand" : "default"}>{isActive ? "Active" : "Paused"}</Badge>
        </div>
        <p className="mt-0.5 truncate font-medium text-foreground">{title}</p>
        <p className="truncate text-xs text-muted" title={subtitle}>
          {subtitle}
        </p>
        {meta ? <p className="mt-1 text-xs text-muted">{meta}</p> : null}
      </div>
      <span className="shrink-0 text-xs font-medium text-muted" aria-hidden>
        Settings →
      </span>
    </NextLink>
  );
}
