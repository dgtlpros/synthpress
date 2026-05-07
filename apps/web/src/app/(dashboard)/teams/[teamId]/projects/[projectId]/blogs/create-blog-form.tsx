"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createBlog } from "@/actions/workspace";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";

export function CreateBlogForm({
  teamId,
  projectId,
}: {
  teamId: string;
  projectId: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createBlog({ teamId, projectId, name });
      if (!result.data) {
        setError(result.error ?? "Could not create blog.");
        return;
      }
      setName("");
      router.push(
        `/teams/${teamId}/projects/${projectId}/blogs/${result.data.id}`,
      );
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="blog-name"
          className="mb-1 block text-xs font-medium text-muted"
        >
          Blog name
        </label>
        <Input
          id="blog-name"
          name="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          placeholder="Main site"
          autoComplete="off"
        />
      </div>
      <Button type="submit" loading={pending} disabled={!name.trim()}>
        Create blog
      </Button>
      {error ? (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
