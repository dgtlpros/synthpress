"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TeamPermissionError } from "@/services/team-policy-service";
import {
  acceptInvite as acceptInviteService,
  createInvite as createInviteService,
  listInvites as listInvitesService,
  revokeInvite as revokeInviteService,
  TeamInviteError,
  type TeamInviteListRow,
} from "@/services/team-invite-service";
import type { Enums } from "@/lib/supabase/database.types";

type TeamRole = Enums<"team_role">;

export interface CreateInviteInput {
  teamId: string;
  role: TeamRole;
  email?: string;
}

export type CreateInviteResult =
  | {
      invite: TeamInviteListRow;
      rawToken: string;
      acceptUrl: string;
      error: null;
    }
  | { invite: null; rawToken: null; acceptUrl: null; error: string };

export async function createInviteAction(
  input: CreateInviteInput,
): Promise<CreateInviteResult> {
  if (!input.teamId) {
    return {
      invite: null,
      rawToken: null,
      acceptUrl: null,
      error: "teamId is required",
    };
  }
  if (input.role !== "admin" && input.role !== "member") {
    return {
      invite: null,
      rawToken: null,
      acceptUrl: null,
      error: "role must be admin or member",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      invite: null,
      rawToken: null,
      acceptUrl: null,
      error: "Not signed in",
    };
  }

  try {
    const result = await createInviteService({
      teamId: input.teamId,
      role: input.role,
      email: input.email,
      invitedBy: user.id,
      client: createAdminClient(),
    });
    revalidatePath(`/teams/${input.teamId}/settings`);
    return {
      invite: result.invite,
      rawToken: result.rawToken,
      acceptUrl: result.acceptUrl,
      error: null,
    };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { invite: null, rawToken: null, acceptUrl: null, error: err.code };
    }
    return {
      invite: null,
      rawToken: null,
      acceptUrl: null,
      error: err instanceof Error ? err.message : "Failed to create invite",
    };
  }
}

export type AcceptInviteResult =
  | { teamId: string; role: TeamRole; error: null }
  | { teamId: null; role: null; error: string };

export async function acceptInviteAction(
  rawToken: string,
): Promise<AcceptInviteResult> {
  if (!rawToken) {
    return { teamId: null, role: null, error: "Missing invite token." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return { teamId: null, role: null, error: "Not signed in" };
  }

  try {
    const result = await acceptInviteService({
      rawToken,
      userId: user.id,
      userEmail: user.email,
      client: createAdminClient(),
    });
    revalidatePath(`/teams/${result.teamId}/projects`);
    revalidatePath("/teams");
    revalidatePath("/dashboard");
    return { teamId: result.teamId, role: result.role, error: null };
  } catch (err) {
    if (err instanceof TeamInviteError) {
      return { teamId: null, role: null, error: err.code };
    }
    return {
      teamId: null,
      role: null,
      error: err instanceof Error ? err.message : "Failed to accept invite",
    };
  }
}

export type RevokeInviteResult =
  | { ok: true; error: null }
  | { ok: false; error: string };

export async function revokeInviteAction(
  inviteId: string,
): Promise<RevokeInviteResult> {
  if (!inviteId) {
    return { ok: false, error: "inviteId is required" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not signed in" };
  }

  try {
    const admin = createAdminClient();
    const { data: row } = await admin
      .from("team_invites")
      .select("team_id")
      .eq("id", inviteId)
      .maybeSingle();

    await revokeInviteService({
      inviteId,
      actorUserId: user.id,
      client: admin,
    });

    if (row?.team_id) {
      revalidatePath(`/teams/${row.team_id}/settings`);
    }
    return { ok: true, error: null };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { ok: false, error: err.code };
    }
    if (err instanceof TeamInviteError) {
      return { ok: false, error: err.code };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to revoke invite",
    };
  }
}

export type ListInvitesResult =
  | { invites: TeamInviteListRow[]; error: null }
  | { invites: null; error: string };

export async function listInvitesAction(
  teamId: string,
  options: { includeAccepted?: boolean } = {},
): Promise<ListInvitesResult> {
  if (!teamId) {
    return { invites: null, error: "teamId is required" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { invites: null, error: "Not signed in" };
  }

  try {
    const invites = await listInvitesService({
      teamId,
      actorUserId: user.id,
      includeAccepted: options.includeAccepted,
      client: createAdminClient(),
    });
    return { invites, error: null };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { invites: null, error: err.code };
    }
    return {
      invites: null,
      error: err instanceof Error ? err.message : "Failed to load invites",
    };
  }
}
