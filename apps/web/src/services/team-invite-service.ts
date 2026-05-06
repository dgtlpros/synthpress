import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, type TeamRole, TeamPermissionError } from "./team-policy-service";

type Client = SupabaseClient<Database>;

export type TeamInvite = Tables<"team_invites">;

/** Same shape as TeamInvite but without the hashed token (never sent to UI). */
export type TeamInviteListRow = Omit<TeamInvite, "token_hash">;

export class TeamInviteError extends Error {
  readonly code:
    | "not_found"
    | "expired"
    | "revoked"
    | "already_accepted"
    | "wrong_email"
    | "already_member";

  constructor(code: TeamInviteError["code"], message: string) {
    super(message);
    this.name = "TeamInviteError";
    this.code = code;
  }
}

const INVITE_TOKEN_BYTES = 32;
const INVITABLE_ROLES: readonly TeamRole[] = ["admin", "member"] as const;

/**
 * Generates a 32-byte URL-safe random token (base64url, no padding).
 * 256 bits of entropy is well above what we need for short-lived
 * single-use invite links and matches the Supabase Auth token format.
 */
export function generateRawInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
}

/** SHA-256 hex digest of a raw token; what we store and what we compare on accept. */
export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Returns the canonical absolute accept URL for a raw invite token.
 * Uses NEXT_PUBLIC_APP_URL when set, otherwise falls back to localhost
 * (matches the convention used in stripe checkout return URLs).
 */
export function buildInviteAcceptUrl(rawToken: string, appUrl?: string): string {
  const base = (appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/teams/invite/${rawToken}`;
}

export interface CreateInviteInput {
  teamId: string;
  role: TeamRole;
  email?: string | null;
  invitedBy: string;
  client?: Client;
}

export interface CreateInviteResult {
  invite: TeamInviteListRow;
  rawToken: string;
  acceptUrl: string;
}

/**
 * Creates a single-use invite. The raw token is returned ONCE so the UI
 * can show a "Copy link" affordance; only the SHA-256 hash is persisted.
 *
 * Caller is expected to have already passed `assertCan(teamId, invitedBy,
 * "invite_member")` — this service double-checks anyway as a defence in
 * depth (server actions are the only gate today, but services may be
 * reused from other entry points later).
 */
export async function createInvite(input: CreateInviteInput): Promise<CreateInviteResult> {
  if (!INVITABLE_ROLES.includes(input.role)) {
    throw new Error(`createInvite: invalid role ${input.role} (cannot invite owners)`);
  }

  const supabase = input.client ?? createAdminClient();
  await assertCan(input.teamId, input.invitedBy, "invite_member", supabase);

  const normalizedEmail = input.email ? input.email.trim().toLowerCase() : null;
  const rawToken = generateRawInviteToken();
  const tokenHash = hashInviteToken(rawToken);

  const insert: TablesInsert<"team_invites"> = {
    team_id: input.teamId,
    role: input.role,
    email: normalizedEmail || null,
    token_hash: tokenHash,
    invited_by: input.invitedBy,
  };

  const { data, error } = await supabase
    .from("team_invites")
    .insert(insert)
    .select("id, team_id, role, email, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("An invite for this email is already pending on this team.");
    }
    throw error;
  }

  return {
    invite: data as TeamInviteListRow,
    rawToken,
    acceptUrl: buildInviteAcceptUrl(rawToken),
  };
}

export interface AcceptInviteInput {
  rawToken: string;
  userId: string;
  userEmail: string;
  client?: Client;
}

export interface AcceptInviteResult {
  teamId: string;
  role: TeamRole;
}

/**
 * Validates the invite (exists, not expired, not revoked, not already
 * accepted, email matches if set) and inserts the user into
 * `team_members`. Marks the invite accepted in the same call so it can't
 * be reused.
 *
 * Idempotent on "already a member": if the user is already in the team,
 * the invite is still marked accepted (so the link stops working) and
 * the existing role is returned.
 */
export async function acceptInvite(input: AcceptInviteInput): Promise<AcceptInviteResult> {
  const supabase = input.client ?? createAdminClient();
  const tokenHash = hashInviteToken(input.rawToken);

  const { data: invite, error: lookupErr } = await supabase
    .from("team_invites")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (lookupErr) throw lookupErr;
  if (!invite) {
    throw new TeamInviteError("not_found", "This invite link is invalid.");
  }

  if (invite.revoked_at) {
    throw new TeamInviteError("revoked", "This invite has been revoked.");
  }
  if (invite.accepted_at) {
    throw new TeamInviteError("already_accepted", "This invite has already been used.");
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    throw new TeamInviteError("expired", "This invite has expired.");
  }

  if (invite.email) {
    const callerEmail = input.userEmail.trim().toLowerCase();
    if (callerEmail !== invite.email.toLowerCase()) {
      throw new TeamInviteError(
        "wrong_email",
        "This invite was sent to a different email address.",
      );
    }
  }

  const role = invite.role as TeamRole;

  const { data: existingMember } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", invite.team_id)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (!existingMember) {
    const { error: insErr } = await supabase
      .from("team_members")
      .insert({ team_id: invite.team_id, user_id: input.userId, role });

    if (insErr) {
      if (insErr.code !== "23505") throw insErr;
    }
  }

  const { error: updErr } = await supabase
    .from("team_invites")
    .update({ accepted_at: new Date().toISOString(), accepted_by: input.userId })
    .eq("id", invite.id);

  if (updErr) throw updErr;

  return {
    teamId: invite.team_id,
    role: existingMember ? (existingMember.role as TeamRole) : role,
  };
}

export interface RevokeInviteInput {
  inviteId: string;
  actorUserId: string;
  client?: Client;
}

export async function revokeInvite(input: RevokeInviteInput): Promise<void> {
  const supabase = input.client ?? createAdminClient();

  const { data: invite, error: lookupErr } = await supabase
    .from("team_invites")
    .select("id, team_id, accepted_at, revoked_at")
    .eq("id", input.inviteId)
    .maybeSingle();

  if (lookupErr) throw lookupErr;
  if (!invite) {
    throw new TeamInviteError("not_found", "Invite not found.");
  }

  await assertCan(invite.team_id, input.actorUserId, "revoke_invite", supabase);

  if (invite.accepted_at) {
    throw new TeamInviteError("already_accepted", "This invite has already been used.");
  }
  if (invite.revoked_at) return;

  const { error } = await supabase
    .from("team_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", input.inviteId);

  if (error) throw error;
}

export interface ListInvitesInput {
  teamId: string;
  actorUserId: string;
  includeAccepted?: boolean;
  client?: Client;
}

/**
 * Returns invites for the team. Pending-only by default; pass
 * `includeAccepted: true` to get the full audit history.
 */
export async function listInvites(input: ListInvitesInput): Promise<TeamInviteListRow[]> {
  const supabase = input.client ?? createAdminClient();
  await assertCan(input.teamId, input.actorUserId, "list_invites", supabase);

  let query = supabase
    .from("team_invites")
    .select("id, team_id, role, email, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at")
    .eq("team_id", input.teamId)
    .order("created_at", { ascending: false });

  if (!input.includeAccepted) {
    query = query.is("accepted_at", null).is("revoked_at", null);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as TeamInviteListRow[];
}

export { TeamPermissionError };
