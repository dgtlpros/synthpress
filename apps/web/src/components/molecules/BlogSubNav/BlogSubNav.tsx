"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/atoms/Badge";

export interface BlogSubNavItem {
  /** URL segment appended to {@link BlogSubNavProps.basePath}. Empty string for "Posts" (the index). */
  segment: string;
  label: string;
  badge?: ReactNode;
  /** Renders the item as disabled, tagged "Soon". */
  comingSoon?: boolean;
}

export interface BlogSubNavProps {
  basePath: string;
  items: BlogSubNavItem[];
  className?: string;
}

export function BlogSubNav({ basePath, items, className }: BlogSubNavProps) {
  // `usePathname()` returns `string | null` according to its types; in
  // practice it's always a string inside the App Router but we coalesce
  // defensively so empty-pathname renders match nothing rather than crash.
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Blog sections"
      className={cn(
        "flex items-center gap-1 overflow-x-auto border-b border-border",
        className,
      )}
    >
      {items.map((item) => {
        const href = item.segment ? `${basePath}/${item.segment}` : basePath;
        const isActive = item.segment
          ? pathname === href || pathname.startsWith(`${href}/`)
          : pathname === basePath;

        const className = cn(
          "inline-flex shrink-0 items-center gap-2 -mb-px border-b-2 px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
          isActive
            ? "border-brand-blue text-foreground"
            : "border-transparent text-muted hover:border-border-hover hover:text-foreground",
          item.comingSoon && "pointer-events-none opacity-50",
        );

        if (item.comingSoon) {
          return (
            <span
              key={item.segment || "_index"}
              className={className}
              aria-disabled="true"
            >
              <span>{item.label}</span>
              <Badge size="sm" variant="default">
                Soon
              </Badge>
            </span>
          );
        }

        return (
          <Link
            key={item.segment || "_index"}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={className}
          >
            <span>{item.label}</span>
            {item.badge !== undefined && item.badge !== null ? (
              <span
                className={cn(
                  "inline-flex min-w-[1.25rem] items-center justify-center rounded-[var(--sp-radius-full)] px-1.5 text-[10px] font-semibold",
                  isActive
                    ? "bg-brand-blue/15 text-brand-blue"
                    : "bg-surface-hover text-muted",
                )}
              >
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
