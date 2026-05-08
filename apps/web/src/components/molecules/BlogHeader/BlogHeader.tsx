import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/atoms/Badge";

export interface BlogHeaderProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  description?: string;
  /** Renders an "Autopilot" / "Manual" pill before the actions. */
  automationMode?: "manual" | "autopilot";
  /**
   * The kill switch on the autopilot config. Only meaningful when
   * `automationMode === "autopilot"`: `false` renders a "paused" badge
   * so users see at a glance that the scheduler won't fire even though
   * autopilot is configured. Defaults to `true` so existing callers
   * keep the old "Autopilot on" label.
   */
  automationEnabled?: boolean;
  /** Slot for primary actions (e.g. Generate, Create post, Settings menu). */
  actions?: ReactNode;
}

function badgeFor(
  mode: "manual" | "autopilot",
  enabled: boolean,
): { label: string; variant: "default" | "brand" } {
  if (mode === "manual") {
    return { label: "Manual mode", variant: "default" };
  }
  if (enabled) {
    return { label: "Autopilot on", variant: "brand" };
  }
  return { label: "Autopilot paused", variant: "default" };
}

export function BlogHeader({
  name,
  description,
  automationMode,
  automationEnabled = true,
  actions,
  className,
  children,
  ...props
}: BlogHeaderProps) {
  const badge = automationMode
    ? badgeFor(automationMode, automationEnabled)
    : null;
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-2xl font-bold text-foreground sm:text-3xl">
            {name}
          </h1>
          {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
        </div>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p>
        ) : null}
        {children}
      </div>

      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
