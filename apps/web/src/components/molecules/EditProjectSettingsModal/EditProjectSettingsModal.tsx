import type { ReactNode } from "react";
import { Modal } from "@/components/atoms/Modal";
import { Input } from "@/components/atoms/Input";
import { Textarea } from "@/components/atoms/Textarea";
import { Label } from "@/components/atoms/Label";

export interface EditProjectSettingsModalProps {
  open: boolean;
  onClose: () => void;
  projectName: string;
  description: string;
  onProjectNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  errorMessage?: string | null;
  pending?: boolean;
  footer: ReactNode;
}

export function EditProjectSettingsModal({
  open,
  onClose,
  projectName,
  description,
  onProjectNameChange,
  onDescriptionChange,
  errorMessage,
  pending = false,
  footer,
}: EditProjectSettingsModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Project settings"
      description="Change the project name and description. The name is shown across your workspace."
      footer={footer}
      maxWidth="lg"
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="edit-project-name">Project name</Label>
          <Input
            id="edit-project-name"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            disabled={pending}
            className="mt-1.5"
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="edit-project-description">Description</Label>
          <Textarea
            id="edit-project-description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            disabled={pending}
            rows={4}
            placeholder="What is this project for?"
            className="mt-1.5 min-h-[88px] resize-y"
          />
        </div>
        {errorMessage ? (
          <p className="text-sm text-error">{errorMessage}</p>
        ) : null}
      </div>
    </Modal>
  );
}
