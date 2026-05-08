import {
  Badge,
  type BadgeProps,
  type BadgeSize,
} from "@/components/atoms/Badge";

/**
 * Mirrors the `article_status` Postgres enum 1:1. The UI labels are
 * editorial — "Ready for review" rather than `ready_for_review`. Both
 * `ready` (legacy, pre-migration 00016) and `ready_for_review` (current
 * canonical value) collapse to the same UI label so generated articles
 * and any older drafts render consistently.
 */
export type PostStatus =
  | "draft"
  | "generating"
  | "ready"
  | "ready_for_review"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "archived";

const labels: Record<PostStatus, string> = {
  draft: "Draft",
  generating: "Generating",
  ready: "Ready for review",
  ready_for_review: "Ready for review",
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
  ready_for_review: "lime",
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
  "ready_for_review",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "archived",
] as const;

export function getPostStatusLabel(status: PostStatus): string {
  return labels[status];
}
