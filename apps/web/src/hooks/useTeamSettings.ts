"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInviteAction, revokeInviteAction } from "@/actions/team-invites";
import { changeMemberRole, removeMember } from "@/actions/team-members";
import {
  updateTeam,
  deleteTeam as deleteTeamAction,
} from "@/actions/workspace";
import type { TeamRole } from "@/lib/team-roles";

export interface NewInvite {
  rawToken: string;
  acceptUrl: string;
  email: string | null;
  role: TeamRole;
  inviteId: string;
}

export interface UseTeamSettingsOptions {
  teamId: string;
}

export interface UseTeamSettingsResult {
  newInvite: NewInvite | null;
  dismissNewInvite: () => void;

  createInvite: (input: { email: string; role: TeamRole }) => void;
  isCreatingInvite: boolean;
  inviteError: string | null;

  revoke: (inviteId: string) => void;
  isRevoking: string | null;
  revokeError: string | null;

  remove: (userId: string) => void;
  isRemoving: string | null;
  removeError: string | null;

  changeRole: (userId: string, role: TeamRole) => void;
  isChangingRole: string | null;
  changeRoleError: string | null;

  renameTeam: (name: string) => void;
  isRenamingTeam: boolean;
  renameTeamError: string | null;

  deleteTeam: () => void;
  isDeletingTeam: boolean;
  deleteTeamError: string | null;
}

export function useTeamSettings({
  teamId,
}: UseTeamSettingsOptions): UseTeamSettingsResult {
  const router = useRouter();
  const [newInvite, setNewInvite] = useState<NewInvite | null>(null);

  const [isCreatingInvite, startCreate] = useTransition();
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [isRevoking, setIsRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const [isRemoving, setIsRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [isChangingRole, setIsChangingRole] = useState<string | null>(null);
  const [changeRoleError, setChangeRoleError] = useState<string | null>(null);

  const [isRenamingTeam, startRename] = useTransition();
  const [renameTeamError, setRenameTeamError] = useState<string | null>(null);

  const [isDeletingTeam, startDelete] = useTransition();
  const [deleteTeamError, setDeleteTeamError] = useState<string | null>(null);

  const dismissNewInvite = useCallback(() => setNewInvite(null), []);

  const createInvite = useCallback(
    (input: { email: string; role: TeamRole }) => {
      setInviteError(null);
      startCreate(async () => {
        const result = await createInviteAction({
          teamId,
          role: input.role,
          email: input.email.trim() || undefined,
        });
        if (result.error || !result.invite) {
          setInviteError(result.error ?? "Failed to create invite");
          return;
        }
        setNewInvite({
          rawToken: result.rawToken!,
          acceptUrl: result.acceptUrl!,
          email: result.invite.email,
          role: result.invite.role as TeamRole,
          inviteId: result.invite.id,
        });
        router.refresh();
      });
    },
    [router, teamId],
  );

  const revoke = useCallback(
    (inviteId: string) => {
      setRevokeError(null);
      setIsRevoking(inviteId);
      void revokeInviteAction(inviteId)
        .then((result) => {
          if (!result.ok) {
            setRevokeError(result.error);
          } else {
            if (newInvite?.inviteId === inviteId) {
              setNewInvite(null);
            }
            router.refresh();
          }
        })
        .finally(() => {
          setIsRevoking(null);
        });
    },
    [router, newInvite],
  );

  const remove = useCallback(
    (userId: string) => {
      setRemoveError(null);
      setIsRemoving(userId);
      void removeMember(teamId, userId)
        .then((result) => {
          if (!result.ok) {
            setRemoveError(result.error);
          } else {
            router.refresh();
          }
        })
        .finally(() => {
          setIsRemoving(null);
        });
    },
    [router, teamId],
  );

  const changeRole = useCallback(
    (userId: string, role: TeamRole) => {
      setChangeRoleError(null);
      setIsChangingRole(userId);
      void changeMemberRole(teamId, userId, role)
        .then((result) => {
          if (!result.ok) {
            setChangeRoleError(result.error);
          } else {
            router.refresh();
          }
        })
        .finally(() => {
          setIsChangingRole(null);
        });
    },
    [router, teamId],
  );

  const renameTeam = useCallback(
    (name: string) => {
      setRenameTeamError(null);
      startRename(async () => {
        const result = await updateTeam(teamId, { name });
        if (result.error) {
          setRenameTeamError(result.error);
          return;
        }
        router.refresh();
      });
    },
    [router, teamId],
  );

  const deleteTeam = useCallback(() => {
    setDeleteTeamError(null);
    startDelete(async () => {
      const result = await deleteTeamAction(teamId);
      if (result.error) {
        setDeleteTeamError(result.error);
        return;
      }
      router.push("/teams");
    });
  }, [router, teamId]);

  return {
    newInvite,
    dismissNewInvite,
    createInvite,
    isCreatingInvite,
    inviteError,
    revoke,
    isRevoking,
    revokeError,
    remove,
    isRemoving,
    removeError,
    changeRole,
    isChangingRole,
    changeRoleError,
    renameTeam,
    isRenamingTeam,
    renameTeamError,
    deleteTeam,
    isDeletingTeam,
    deleteTeamError,
  };
}
