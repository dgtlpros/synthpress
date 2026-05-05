import NextLink from "next/link";
import { cn } from "@/lib/cn";

export interface SidebarNavItem {
  label: string;
  href: string;
  isActive?: boolean;
}

export interface DashboardSidebarProps {
  navItems: SidebarNavItem[];
  email?: string | null;
  /** Optional callback invoked when a nav link is clicked. Used by the
   *  mobile drawer to close itself. */
  onItemClick?: () => void;
  className?: string;
}

export function DashboardSidebar({
  navItems,
  email,
  onItemClick,
  className,
}: DashboardSidebarProps) {
  return (
    <aside
      className={cn(
        "flex w-64 flex-col border-r border-border bg-surface",
        className,
      )}
      aria-label="Primary navigation"
    >
      <div className="flex h-16 items-center border-b border-border px-6">
        <NextLink
          href="/"
          className="flex items-center"
          onClick={onItemClick}
          aria-label="Go to home"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/synthpress-full-logo.svg"
            alt="SynthPress"
            className="h-11 w-auto"
          />
        </NextLink>
      </div>

      <nav className="flex-1 space-y-1 p-4" aria-label="Sections">
        {navItems.map((item) => (
          <NextLink
            key={item.href}
            href={item.href}
            onClick={onItemClick}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-[var(--sp-radius-lg)] px-3 py-2 text-sm font-medium transition-colors",
              item.isActive
                ? "bg-surface-hover text-foreground"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
            aria-current={item.isActive ? "page" : undefined}
          >
            {item.label}
          </NextLink>
        ))}
      </nav>

      {email && (
        <div className="border-t border-border px-6 py-4">
          <p className="truncate text-xs text-muted" title={email}>
            {email}
          </p>
        </div>
      )}
    </aside>
  );
}
