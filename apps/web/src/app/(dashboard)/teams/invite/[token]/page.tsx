import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUserOncePerResponse } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashInviteToken } from "@/services/team-invite-service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/Card";
import { AcceptInviteConnector } from "@/connectors/AcceptInviteConnector";

export const dynamic = "force-dynamic";

interface InviteRow {
  id: string;
  team_id: string;
  role: "owner" | "admin" | "member";
  email: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  invited_by: string;
  team: { id: string; name: string; slug: string } | null;
  inviter: { id: string; full_name: string | null } | null;
}

type InviteStatus =
  | { kind: "not_found" }
  | { kind: "revoked" }
  | { kind: "already_accepted" }
  | { kind: "expired" }
  | { kind: "wrong_email"; teamName: string }
  | { kind: "ready"; row: InviteRow };

async function loadInvite(
  rawToken: string,
  callerEmail: string | null,
): Promise<InviteStatus> {
  const admin = createAdminClient();
  const tokenHash = hashInviteToken(rawToken);

  const { data, error } = await admin
    .from("team_invites")
    .select(
      `
      id, team_id, role, email, expires_at, accepted_at, revoked_at, invited_by,
      team:teams(id, name, slug),
      inviter:profiles!team_invites_invited_by_fkey(id, full_name)
    `,
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return { kind: "not_found" };

  const row = data as unknown as InviteRow;

  if (row.revoked_at) return { kind: "revoked" };
  if (row.accepted_at) return { kind: "already_accepted" };
  if (new Date(row.expires_at).getTime() < Date.now())
    return { kind: "expired" };

  if (row.email && callerEmail) {
    if (row.email.toLowerCase() !== callerEmail.toLowerCase()) {
      return { kind: "wrong_email", teamName: row.team?.name ?? "this team" };
    }
  }

  return { kind: "ready", row };
}

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const {
    data: { user },
  } = await getAuthUserOncePerResponse();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/teams/invite/${token}`)}`);
  }

  const status = await loadInvite(token, user.email ?? null);

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        {status.kind === "ready" ? (
          <>
            <CardHeader>
              <CardTitle>
                You&apos;ve been invited to {status.row.team?.name ?? "a team"}
              </CardTitle>
              <CardDescription>
                {status.row.inviter?.full_name ? (
                  <>
                    <span className="font-medium text-foreground">
                      {status.row.inviter.full_name}
                    </span>{" "}
                    invited you to join as{" "}
                    <span className="font-medium text-foreground">
                      {status.row.role}
                    </span>
                    .
                  </>
                ) : (
                  <>
                    You&apos;re invited to join as{" "}
                    <span className="font-medium text-foreground">
                      {status.row.role}
                    </span>
                    .
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted">
                Members can run jobs and edit content; the team owner&apos;s
                subscription and tokens power the team.
              </p>
              <AcceptInviteConnector
                rawToken={token}
                teamId={status.row.team_id}
                teamName={status.row.team?.name ?? "the team"}
              />
            </CardContent>
          </>
        ) : null}

        {status.kind === "not_found" ? (
          <>
            <CardHeader>
              <CardTitle>Invalid invite link</CardTitle>
              <CardDescription>
                This link doesn&apos;t match any active invite. The team may
                have revoked it, or the URL may have been mistyped.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/teams"
                className="text-sm font-medium text-brand-blue hover:text-brand-indigo"
              >
                Go to my teams →
              </Link>
            </CardContent>
          </>
        ) : null}

        {status.kind === "revoked" ? (
          <>
            <CardHeader>
              <CardTitle>This invite was revoked</CardTitle>
              <CardDescription>
                The team owner or an admin revoked this invite. Ask them for a
                new link.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/teams"
                className="text-sm font-medium text-brand-blue hover:text-brand-indigo"
              >
                Go to my teams →
              </Link>
            </CardContent>
          </>
        ) : null}

        {status.kind === "already_accepted" ? (
          <>
            <CardHeader>
              <CardTitle>This invite has already been used</CardTitle>
              <CardDescription>
                If you accepted it earlier, the team should already be in your
                sidebar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/teams"
                className="text-sm font-medium text-brand-blue hover:text-brand-indigo"
              >
                Go to my teams →
              </Link>
            </CardContent>
          </>
        ) : null}

        {status.kind === "expired" ? (
          <>
            <CardHeader>
              <CardTitle>This invite has expired</CardTitle>
              <CardDescription>
                Ask the team to send you a new link.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/teams"
                className="text-sm font-medium text-brand-blue hover:text-brand-indigo"
              >
                Go to my teams →
              </Link>
            </CardContent>
          </>
        ) : null}

        {status.kind === "wrong_email" ? (
          <>
            <CardHeader>
              <CardTitle>This invite is for a different email</CardTitle>
              <CardDescription>
                You&apos;re signed in as{" "}
                <span className="font-medium text-foreground">
                  {user.email}
                </span>
                , but this invite to{" "}
                <span className="font-medium text-foreground">
                  {status.teamName}
                </span>{" "}
                was sent to a different address. Sign out and sign in with the
                invited email, or ask for an open link.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/account"
                className="text-sm font-medium text-brand-blue hover:text-brand-indigo"
              >
                Manage account →
              </Link>
            </CardContent>
          </>
        ) : null}
      </Card>
    </div>
  );
}
