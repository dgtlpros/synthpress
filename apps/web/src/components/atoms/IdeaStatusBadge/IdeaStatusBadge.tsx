import {
  Badge,
  type BadgeProps,
  type BadgeSize,
} from "@/components/atoms/Badge";

/**
 * Visual mapping for `article_ideas.status`. The DB column is plain
 * text + check constraint (see `00016_article_generation.sql`); this
 * type and the maps below are the UI source of truth.
 */
export type IdeaStatus =
  | "generated"
  | "approved"
  | "rejected"
  | "converted_to_article";

const labels: Record<IdeaStatus, string> = {
  generated: "Generated",
  approved: "Approved",
  rejected: "Rejected",
  converted_to_article: "Converted",
};

const variants: Record<IdeaStatus, BadgeProps["variant"]> = {
  generated: "default",
  approved: "lime",
  rejected: "error",
  converted_to_article: "success",
};

export interface IdeaStatusBadgeProps {
  status: IdeaStatus;
  size?: BadgeSize;
  className?: string;
}

export function IdeaStatusBadge({
  status,
  size = "sm",
  className,
}: IdeaStatusBadgeProps) {
  return (
    <Badge variant={variants[status]} size={size} className={className}>
      {labels[status]}
    </Badge>
  );
}

export const IDEA_STATUSES: readonly IdeaStatus[] = [
  "generated",
  "approved",
  "rejected",
  "converted_to_article",
] as const;

export function getIdeaStatusLabel(status: IdeaStatus): string {
  return labels[status];
}
