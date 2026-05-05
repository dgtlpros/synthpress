import { cn } from "@/lib/cn";
import { Badge, type BadgeVariant } from "@/components/atoms/Badge";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "incomplete"
  | "canceled"
  | "unpaid"
  | "paused"
  | "free";

export interface PlanBadgeProps {
  planName: string;
  status?: SubscriptionStatus;
  className?: string;
}

const statusConfig: Record<SubscriptionStatus, { variant: BadgeVariant; suffix?: string }> = {
  active: { variant: "brand" },
  trialing: { variant: "brand", suffix: "Trialing" },
  past_due: { variant: "warning", suffix: "Past due" },
  incomplete: { variant: "warning", suffix: "Incomplete" },
  canceled: { variant: "default", suffix: "Canceled" },
  unpaid: { variant: "error", suffix: "Unpaid" },
  paused: { variant: "default", suffix: "Paused" },
  free: { variant: "default" },
};

export function PlanBadge({ planName, status = "active", className }: PlanBadgeProps) {
  const config = statusConfig[status];
  const label = config.suffix ? `${planName} · ${config.suffix}` : planName;

  return (
    <Badge variant={config.variant} className={cn(className)}>
      {label}
    </Badge>
  );
}
