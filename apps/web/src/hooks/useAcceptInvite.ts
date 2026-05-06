"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInviteAction } from "@/actions/team-invites";

export interface UseAcceptInviteResult {
  accept: () => void;
  isAccepting: boolean;
  error: string | null;
  ok: boolean;
}

export interface UseAcceptInviteOptions {
  rawToken: string;
  teamId: string;
  /** Override the post-accept redirect (default: /teams/[teamId]/projects). */
  redirectTo?: string;
}

/**
 * Hook for the invite-accept button. Calls the `acceptInviteAction` server
 * action; on success, navigates to the team's projects page.
 */
export function useAcceptInvite(options: UseAcceptInviteOptions): UseAcceptInviteResult {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [isAccepting, startTransition] = useTransition();

  function accept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptInviteAction(options.rawToken);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOk(true);
      const target = options.redirectTo ?? `/teams/${options.teamId}/projects`;
      router.push(target);
      router.refresh();
    });
  }

  return { accept, isAccepting, error, ok };
}
