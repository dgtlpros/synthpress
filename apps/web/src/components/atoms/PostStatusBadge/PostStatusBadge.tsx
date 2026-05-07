import {
  Badge,
  type BadgeProps,
  type BadgeSize,
} from "@/components/atoms/Badge";

/**
 * The status surface stored in the DB enum is intentionally narrower than the
 * status surface we want to expose in the UI. We map the DB values to a more
 * editorial vocabulary ("Ready for review" rather than just "Ready") and add
 * the synthetic "scheduled" / "archived" rows the redesigned UI needs.
 */
export type PostStatus =
  | "draft"
  | "generating"
  | "ready"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "archived";

const labels: Record<PostStatus, string> = {
  draft: "Draft",
  generating: "Generating",
  ready: "Ready for review",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  archived: "Archived",
};

const variants: Record<PostStatus, BadgeProps["variant"]> = {
  draft: "default",
  generating: "warning",
  ready: "lime",
  scheduled: "brand",
  publishing: "warning",
  published: "success",
  failed: "error",
  archived: "default",
};

export interface PostStatusBadgeProps {
  status: PostStatus;
  size?: BadgeSize;
  className?: string;
}

export function PostStatusBadge({
  status,
  size = "md",
  className,
}: PostStatusBadgeProps) {
  return (
    <Badge variant={variants[status]} size={size} className={className}>
      {labels[status]}
    </Badge>
  );
}

export const POST_STATUSES: readonly PostStatus[] = [
  "draft",
  "generating",
  "ready",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "archived",
] as const;

export function getPostStatusLabel(status: PostStatus): string {
  return labels[status];
}
