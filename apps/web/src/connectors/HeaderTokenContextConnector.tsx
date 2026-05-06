"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TokenBadge } from "@/components/atoms/TokenBadge";
import type { TeamRole } from "@/lib/team-roles";

export interface HeaderTeamPlan {
  teamId: string;
  teamName: string;
  ownerName: string;
  isOwner: boolean;
  myRole: TeamRole;
  balance: number;
  planKey: string | null;
}

export interface HeaderTokenContextConnectorProps {
  /** Personal balance (the auth user's own tokens). Used outside team routes. */
  personalBalance: number;
  /** Resolved team-billing context for every team the user is on. */
  teamPlans: HeaderTeamPlan[];
}

/**
 * Switches the header token badge between the user's personal balance and
 * the team owner's balance based on the current route. Inside a team route
 * (/teams/[teamId]/...), shows "Spending {teamName} (owner: {ownerName})"
 * with the owner's remaining tokens; everywhere else, shows the user's
 * personal balance.
 */
export function HeaderTokenContextConnector({
  personalBalance,
  teamPlans,
}: HeaderTokenContextConnectorProps) {
  const pathname = usePathname();
  const teamMatch = pathname?.match(/^\/teams\/([^/]+)/);
  const teamId = teamMatch?.[1] ?? null;
  const activeTeam = teamId
    ? (teamPlans.find((t) => t.teamId === teamId) ?? null)
    : null;

  if (activeTeam) {
    const balance = activeTeam.balance;
    const variant = balance <= 50 ? "warning" : "brand";
    const roleLabel =
      activeTeam.myRole === "admin"
        ? " · Admin"
        : activeTeam.myRole === "member"
          ? " · Member"
          : "";
    const tooltip = activeTeam.isOwner
      ? `Spending your balance for ${activeTeam.teamName}`
      : `Spending ${activeTeam.teamName} balance (paid by ${activeTeam.ownerName})${roleLabel}`;
    return (
      <Link
        href={
          activeTeam.isOwner
            ? "/account/billing"
            : `/teams/${activeTeam.teamId}/usage`
        }
        aria-label={tooltip}
        title={tooltip}
        className="cursor-pointer"
      >
        <TokenBadge balance={balance} variant={variant} size="lg" />
      </Link>
    );
  }

  return (
    <Link
      href="/account/billing"
      aria-label="View billing and synth tokens"
      className="cursor-pointer"
    >
      <TokenBadge
        balance={personalBalance}
        variant={personalBalance <= 50 ? "warning" : "brand"}
        size="lg"
      />
    </Link>
  );
}
