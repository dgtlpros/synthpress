"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/atoms/Card";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { Select } from "@/components/atoms/Select";
import { Badge } from "@/components/atoms/Badge";
import { ConfirmModal } from "@/components/atoms/ConfirmModal";
import { roleCan, type TeamRole } from "@/lib/team-roles";
import { useTeamSettings } from "@/hooks/useTeamSettings";

interface MemberRow {
  user_id: string;
  role: TeamRole;
  created_at: string;
  email: string | null;
  full_name: string | null;
}

interface InviteRow {
  id: string;
  team_id: string;
  role: TeamRole;
  email: string | null;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface TeamSettingsConnectorProps {
  teamId: string;
  teamName: string;
  currentUserId: string;
  currentUserRole: TeamRole;
  ownerUserId: string;
  members: MemberRow[];
  invites: InviteRow[];
}

const ROLE_OPTIONS = [
  { value: "member", label: "Member (developer)" },
  { value: "admin", label: "Admin" },
];

function roleBadgeVariant(role: TeamRole): "brand" | "warning" | "default" {
  if (role === "owner") return "brand";
  if (role === "admin") return "warning";
  return "default";
}

function memberLabel(m: MemberRow): string {
  return m.full_name?.trim() || m.email || m.user_id.slice(0, 8);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function TeamSettingsConnector({
  teamId,
  teamName,
  currentUserId,
  currentUserRole,
  ownerUserId,
  members,
  invites,
}: TeamSettingsConnectorProps) {
  const settings = useTeamSettings({ teamId });
  const canInvite = roleCan(currentUserRole, "invite_member");
  const canChangeRole = roleCan(currentUserRole, "change_role");
  const canRemove = roleCan(currentUserRole, "remove_member");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("member");
  const [copyConfirm, setCopyConfirm] = useState(false);
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string | null>(null);

  function handleInviteSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    settings.createInvite({ email: inviteEmail, role: inviteRole });
    setInviteEmail("");
  }

  async function copyToClipboard(text: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyConfirm(true);
      setTimeout(() => setCopyConfirm(false), 1500);
    } catch {
      // Clipboard API can be blocked in some browsers; the input remains
      // selectable so the user can copy manually.
    }
  }

  return (
    <div className="space-y-8">
      {canInvite ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite a member to {teamName}</CardTitle>
            <CardDescription>
              We&apos;ll generate a one-time link you can share with them. Owners and admins can
              invite; new members can run jobs and edit content (their actions spend the
              owner&apos;s tokens).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInviteSubmit} className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
              <div>
                <label htmlFor="invite-email" className="sr-only">
                  Email (optional)
                </label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  placeholder="teammate@example.com (optional)"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  autoComplete="off"
                  disabled={settings.isCreatingInvite}
                />
              </div>
              <div>
                <label htmlFor="invite-role" className="sr-only">
                  Role
                </label>
                <Select
                  id="invite-role"
                  name="role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as TeamRole)}
                  options={ROLE_OPTIONS}
                  disabled={settings.isCreatingInvite}
                />
              </div>
              <Button type="submit" loading={settings.isCreatingInvite}>
                Create invite link
              </Button>
            </form>
            {settings.inviteError ? (
              <p className="mt-2 text-sm text-error" role="alert">
                {settings.inviteError}
              </p>
            ) : null}
            <p className="mt-3 text-xs text-muted">
              Leave email blank for an open link. Setting an email locks the invite to that
              address only.
            </p>

            {settings.newInvite ? (
              <div className="mt-4 rounded-[var(--sp-radius-lg)] border border-success/30 bg-success/10 p-4">
                <p className="text-sm font-medium text-foreground">
                  Invite link ready — copy it before leaving this page.
                </p>
                <p className="mt-1 text-xs text-muted">
                  We never show this link again. If you lose it, just create a new invite.
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    readOnly
                    value={settings.newInvite.acceptUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-9 flex-1 rounded-[var(--sp-radius-md)] border border-border bg-surface px-2 text-xs text-foreground"
                    aria-label="Invite link"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => copyToClipboard(settings.newInvite!.acceptUrl)}
                  >
                    {copyConfirm ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={settings.dismissNewInvite}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {members.length === 1 ? "1 member" : `${members.length} members`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {members.map((m) => {
              const isSelf = m.user_id === currentUserId;
              const isOwner = m.role === "owner" || m.user_id === ownerUserId;
              return (
                <li key={m.user_id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {memberLabel(m)} {isSelf ? <span className="text-muted">(you)</span> : null}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {m.email ?? "no email"} · joined {formatDate(m.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {canChangeRole && !isOwner ? (
                      <Select
                        aria-label={`Change role for ${memberLabel(m)}`}
                        value={m.role}
                        options={ROLE_OPTIONS}
                        disabled={settings.isChangingRole === m.user_id}
                        onChange={(e) =>
                          settings.changeRole(m.user_id, e.target.value as TeamRole)
                        }
                        className="w-44"
                      />
                    ) : (
                      <Badge variant={roleBadgeVariant(m.role)}>{m.role}</Badge>
                    )}
                    {canRemove && !isOwner ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        loading={settings.isRemoving === m.user_id}
                        onClick={() => setConfirmRemoveUserId(m.user_id)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {settings.removeError ? (
            <p className="mt-3 text-sm text-error" role="alert">
              {settings.removeError}
            </p>
          ) : null}
          {settings.changeRoleError ? (
            <p className="mt-3 text-sm text-error" role="alert">
              {settings.changeRoleError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {canInvite ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
            <CardDescription>
              Outstanding invitations that have not yet been accepted or revoked.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {invites.length === 0 ? (
              <p className="text-sm text-muted">No pending invites.</p>
            ) : (
              <ul className="divide-y divide-border">
                {invites.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {inv.email ?? "Open link (any signed-in user)"}
                      </p>
                      <p className="truncate text-xs text-muted">
                        Role: {inv.role} · expires {formatDate(inv.expires_at)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      loading={settings.isRevoking === inv.id}
                      onClick={() => settings.revoke(inv.id)}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {settings.revokeError ? (
              <p className="mt-3 text-sm text-error" role="alert">
                {settings.revokeError}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <ConfirmModal
        open={confirmRemoveUserId !== null}
        title="Remove member"
        message="They will lose access to all projects in this team. They can be re-invited later."
        confirmLabel="Remove"
        variant="danger"
        loading={settings.isRemoving !== null}
        onCancel={() => setConfirmRemoveUserId(null)}
        onConfirm={() => {
          if (confirmRemoveUserId) settings.remove(confirmRemoveUserId);
          setConfirmRemoveUserId(null);
        }}
      />
    </div>
  );
}
