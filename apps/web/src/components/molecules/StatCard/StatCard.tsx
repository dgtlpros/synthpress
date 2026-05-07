import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/atoms/Card";

const toneStyles = {
  default: "text-foreground",
  brand: "text-gradient-accent",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
} as const;

export type StatCardTone = keyof typeof toneStyles;

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: StatCardTone;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
  className,
  ...props
}: StatCardProps) {
  return (
    <Card className={cn("flex flex-col gap-2 p-5", className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </p>
        {icon ? (
          <span className="text-muted" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "text-3xl font-bold leading-none tracking-tight",
          toneStyles[tone],
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </Card>
  );
}
