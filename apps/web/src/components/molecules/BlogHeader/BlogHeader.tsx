import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/atoms/Badge";

export interface BlogHeaderProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  description?: string;
  /** Renders an "Autopilot" / "Manual" pill before the actions. */
  automationMode?: "manual" | "autopilot";
  /** Slot for primary actions (e.g. Generate, Create post, Settings menu). */
  actions?: ReactNode;
}

const modeLabels = {
  manual: "Manual mode",
  autopilot: "Autopilot on",
} as const;

export function BlogHeader({
  name,
  description,
  automationMode,
  actions,
  className,
  children,
  ...props
}: BlogHeaderProps) {
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
          {automationMode ? (
            <Badge
              variant={automationMode === "autopilot" ? "brand" : "default"}
            >
              {modeLabels[automationMode]}
            </Badge>
          ) : null}
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
