"use client";

import { Button } from "@/components/atoms/Button";
import { useAcceptInvite } from "@/hooks/useAcceptInvite";

export interface AcceptInviteConnectorProps {
  rawToken: string;
  teamId: string;
  teamName: string;
}

const ERROR_COPY: Record<string, string> = {
  not_found: "This invite link is invalid.",
  expired: "This invite has expired.",
  revoked: "This invite was revoked.",
  already_accepted: "This invite has already been used.",
  wrong_email: "This invite was sent to a different email address.",
  not_signed_in: "You need to be signed in to accept this invite.",
};

export function AcceptInviteConnector({ rawToken, teamId, teamName }: AcceptInviteConnectorProps) {
  const { accept, isAccepting, error, ok } = useAcceptInvite({ rawToken, teamId });

  return (
    <div className="space-y-2">
      <Button type="button" onClick={accept} loading={isAccepting} disabled={ok}>
        {ok ? "Joined" : `Join ${teamName}`}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-error">
          {ERROR_COPY[error] ?? error}
        </p>
      ) : null}
    </div>
  );
}
