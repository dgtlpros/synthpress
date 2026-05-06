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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const name = String(fd.get("name") ?? "");
    const wpUrl = String(fd.get("wpUrl") ?? "");
    const wpUsername = String(fd.get("wpUsername") ?? "");
    const wpAppPassword = String(fd.get("wpAppPassword") ?? "");
    setError(null);
    startTransition(async () => {
      const result = await createBlog({
        teamId,
        projectId,
        name,
        wpUrl,
        wpUsername,
        wpAppPassword,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      form.reset();
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
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
            disabled={pending}
            placeholder="Main site"
          />
        </div>
        <div className="sm:col-span-2">
          <label
            htmlFor="wp-url"
            className="mb-1 block text-xs font-medium text-muted"
          >
            WordPress site URL
          </label>
          <Input
            id="wp-url"
            name="wpUrl"
            type="url"
            required
            disabled={pending}
            placeholder="https://example.com"
            autoComplete="url"
          />
        </div>
        <div>
          <label
            htmlFor="wp-user"
            className="mb-1 block text-xs font-medium text-muted"
          >
            WordPress username
          </label>
          <Input
            id="wp-user"
            name="wpUsername"
            type="text"
            required
            disabled={pending}
            autoComplete="username"
          />
        </div>
        <div>
          <label
            htmlFor="wp-app-pass"
            className="mb-1 block text-xs font-medium text-muted"
          >
            Application password
          </label>
          <Input
            id="wp-app-pass"
            name="wpAppPassword"
            type="password"
            required
            disabled={pending}
            autoComplete="new-password"
          />
        </div>
      </div>
      <Button type="submit" loading={pending}>
        Add blog
      </Button>
      {error ? <p className="text-sm text-error">{error}</p> : null}
    </form>
  );
}
