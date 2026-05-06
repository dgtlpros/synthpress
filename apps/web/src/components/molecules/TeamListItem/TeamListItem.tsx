import NextLink from "next/link";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/atoms/Avatar";
import {
  PlanBadge,
  type SubscriptionStatus,
} from "@/components/atoms/PlanBadge";
import { TokenBadge } from "@/components/atoms/TokenBadge";

const KNOWN_STATUSES: SubscriptionStatus[] = [
  "active",
  "trialing",
  "canceling",
  "past_due",
  "incomplete",
  "canceled",
  "unpaid",
  "paused",
  "free",
];

function normalizePlanStatus(
  status: string | null | undefined,
  hasPlan: boolean,
): SubscriptionStatus {
  if (!hasPlan) return "free";
  if (!status) return "active";
  return (KNOWN_STATUSES as string[]).includes(status)
    ? (status as SubscriptionStatus)
    : "active";
}

export interface TeamListItemProps {
  href: string;
  name: string;
  ownerLabel: string;
  ownerAvatarUrl?: string | null;
  ownerInitials: string;
  memberCount: number;
  projectCount: number;
  planDisplayName: string;
  planStatus?: string | null;
  balance: number;
  className?: string;
}

export function TeamListItem({
  href,
  name,
  ownerLabel,
  ownerAvatarUrl,
  ownerInitials,
  memberCount,
  projectCount,
  planDisplayName,
  planStatus,
  balance,
  className,
}: TeamListItemProps) {
  const hasPaidPlan = planDisplayName !== "Free";
  const badgeStatus = normalizePlanStatus(planStatus, hasPaidPlan);
  const stats = `${memberCount} ${memberCount === 1 ? "member" : "members"} · ${projectCount} ${projectCount === 1 ? "project" : "projects"}`;

  const ariaLabel = `${name}. ${ownerLabel}. ${stats}. ${planDisplayName}. ${balance.toLocaleString("en-US")} tokens.`;

  return (
    <NextLink
      href={href}
      aria-label={ariaLabel}
      className={cn(
        "flex flex-col gap-3 rounded-[var(--sp-radius-lg)] border border-border bg-surface px-4 py-3 text-left shadow-sm transition-colors hover:bg-surface-hover sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Avatar
          src={ownerAvatarUrl ?? undefined}
          alt=""
          fallback={ownerInitials}
          size="sm"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {name}
          </p>
          <p className="truncate text-xs text-muted">{ownerLabel}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
        <p className="text-xs text-muted sm:text-right">{stats}</p>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <PlanBadge planName={planDisplayName} status={badgeStatus} />
          <TokenBadge balance={balance} size="sm" variant="neutral" />
        </div>
      </div>
    </NextLink>
  );
}
