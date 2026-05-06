"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createWorkspaceProject } from "@/actions/workspace";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";

export function CreateProjectForm({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "");
    setError(null);
    startTransition(async () => {
      const result = await createWorkspaceProject(teamId, name);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.data) {
        router.push(`/teams/${teamId}/projects/${result.data.id}`);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="new-project-name" className="sr-only">
          Project name
        </label>
        <Input
          id="new-project-name"
          name="name"
          type="text"
          placeholder="e.g. Q2 content engine"
          required
          disabled={pending}
          className="sm:max-w-md"
        />
        <Button type="submit" loading={pending}>
          Create project
        </Button>
      </div>
      {error ? <p className="text-sm text-error">{error}</p> : null}
    </form>
  );
}
