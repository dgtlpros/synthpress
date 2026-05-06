import type { ReactNode } from "react";
import { Modal } from "@/components/atoms/Modal";
import { Input } from "@/components/atoms/Input";
import { Label } from "@/components/atoms/Label";

export interface EditTeamSettingsModalProps {
  open: boolean;
  onClose: () => void;
  teamName: string;
  onTeamNameChange: (value: string) => void;
  errorMessage?: string | null;
  pending?: boolean;
  footer: ReactNode;
}

export function EditTeamSettingsModal({
  open,
  onClose,
  teamName,
  onTeamNameChange,
  errorMessage,
  pending = false,
  footer,
}: EditTeamSettingsModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Team settings"
      description="Change the team name. The name is shown across your workspace."
      footer={footer}
      maxWidth="md"
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="edit-team-name">Team name</Label>
          <Input
            id="edit-team-name"
            value={teamName}
            onChange={(e) => onTeamNameChange(e.target.value)}
            disabled={pending}
            className="mt-1.5"
            autoComplete="off"
          />
        </div>
        {errorMessage ? (
          <p className="text-sm text-error">{errorMessage}</p>
        ) : null}
      </div>
    </Modal>
  );
}
