import {
  Badge,
  type BadgeProps,
  type BadgeSize,
} from "@/components/atoms/Badge";

/**
 * Visual mapping for `blog_autopilot_runs.status`. The DB column is
 * plain text + check constraint (see migration 00019); this type and
 * the maps below are the UI source of truth.
 *
 * `processing` and `pending` reuse the `brand` variant since they're
 * "in flight" states. Other statuses each get a distinct color so
 * a glance at the recent-runs panel reads like a status timeline.
 */
export type AutopilotRunStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

const labels: Record<AutopilotRunStatus, string> = {
  pending: "Queued",
  processing: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

const variants: Record<AutopilotRunStatus, BadgeProps["variant"]> = {
  pending: "default",
  processing: "brand",
  completed: "success",
  failed: "error",
  cancelled: "default",
  // `skipped` is a "we ran successfully but didn't need to do
  // anything" outcome — neutral lime keeps it visually distinct
  // from a plain "completed" while still reading as healthy.
  skipped: "lime",
};

export interface AutopilotRunStatusBadgeProps {
  status: AutopilotRunStatus;
  size?: BadgeSize;
  className?: string;
}

export function AutopilotRunStatusBadge({
  status,
  size = "sm",
  className,
}: AutopilotRunStatusBadgeProps) {
  return (
    <Badge variant={variants[status]} size={size} className={className}>
      {labels[status]}
    </Badge>
  );
}

export const AUTOPILOT_RUN_STATUSES: readonly AutopilotRunStatus[] = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
  "skipped",
] as const;

export function getAutopilotRunStatusLabel(status: AutopilotRunStatus): string {
  return labels[status];
}
