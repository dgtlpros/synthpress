"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { updateProjectDescription } from "@/actions/workspace";
import { Button } from "@/components/atoms/Button";
import { Textarea } from "@/components/atoms/Textarea";

export interface EditProjectDescriptionConnectorProps {
  teamId: string;
  projectId: string;
  initialDescription: string;
  className?: string;
}

export function EditProjectDescriptionConnector({
  teamId,
  projectId,
  initialDescription,
  className,
}: EditProjectDescriptionConnectorProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialDescription);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateProjectDescription(teamId, projectId, value);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={cn(className)}>
      <label htmlFor="project-description" className="sr-only">
        Project description
      </label>
      <Textarea
        id="project-description"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        rows={4}
        placeholder="Add a description for this project"
        className="min-h-[100px] resize-y"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" loading={pending} onClick={onSave}>
          Save description
        </Button>
        {error ? <p className="text-sm text-error">{error}</p> : null}
      </div>
    </div>
  );
}
