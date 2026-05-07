"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { Label } from "@/components/atoms/Label";
import { Badge } from "@/components/atoms/Badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/atoms/Card";

export interface WordPressConnectionFormProps {
  /** Existing site URL (e.g. `https://example.com`) or `null` if not connected. */
  initialUrl: string | null;
  /** Existing REST username, or `null` if not connected. */
  initialUsername: string | null;
  /** True iff the blog already has a stored application password. */
  hasStoredPassword: boolean;
  /**
   * Called when the form is submitted with valid input. Pass the raw fields
   * (the parent decides whether to persist or just preview).
   */
  onSubmit: (input: {
    wpUrl: string;
    wpUsername: string;
    wpAppPassword: string;
  }) => void | Promise<void>;
  /** Called when the user clicks "Disconnect". The parent typically clears all 3 fields. */
  onDisconnect?: () => void | Promise<void>;
  isSaving?: boolean;
  isDisconnecting?: boolean;
  error?: string | null;
  className?: string;
}

const URL_PATTERN = /^https?:\/\/.+/i;

export function WordPressConnectionForm({
  initialUrl,
  initialUsername,
  hasStoredPassword,
  onSubmit,
  onDisconnect,
  isSaving,
  isDisconnecting,
  error,
  className,
}: WordPressConnectionFormProps) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [username, setUsername] = useState(initialUsername ?? "");
  const [appPassword, setAppPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const isConnected = Boolean(initialUrl && initialUsername);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError(null);

    const trimmedUrl = url.trim();
    const trimmedUsername = username.trim();

    if (!trimmedUrl || !trimmedUsername) {
      setLocalError("Site URL and username are required.");
      return;
    }
    if (!URL_PATTERN.test(trimmedUrl)) {
      setLocalError("Site URL must start with http:// or https://.");
      return;
    }
    if (!appPassword && !hasStoredPassword) {
      setLocalError("Application password is required to connect.");
      return;
    }

    void onSubmit({
      wpUrl: trimmedUrl,
      wpUsername: trimmedUsername,
      wpAppPassword: appPassword || "",
    });
  }

  const message = error ?? localError;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>WordPress</CardTitle>
            <CardDescription>
              Publish drafts and scheduled posts directly to your WordPress
              site.
            </CardDescription>
          </div>
          <Badge variant={isConnected ? "success" : "default"}>
            {isConnected ? "Connected" : "Not connected"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <form
          id="wordpress-connection-form"
          onSubmit={handleSubmit}
          noValidate
          className="space-y-4"
        >
          <div>
            <Label htmlFor="wp-url" required>
              Site URL
            </Label>
            <Input
              id="wp-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              disabled={isSaving}
              autoComplete="url"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="wp-username" required>
              REST username
            </Label>
            <Input
              id="wp-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your-wp-user"
              disabled={isSaving}
              autoComplete="username"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="wp-password" required={!hasStoredPassword}>
              Application password
            </Label>
            <Input
              id="wp-password"
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder={
                hasStoredPassword
                  ? "Leave empty to keep the existing password"
                  : "wp-app-password"
              }
              disabled={isSaving}
              autoComplete="new-password"
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted">
              Generate one in WordPress under{" "}
              <span className="font-mono">
                Users → Profile → Application Passwords
              </span>
              .
            </p>
          </div>

          {message ? (
            <p className="text-sm text-error" role="alert">
              {message}
            </p>
          ) : null}
        </form>
      </CardContent>

      <CardFooter className="justify-end">
        {isConnected && onDisconnect ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={isDisconnecting}
            onClick={() => onDisconnect()}
            className="text-error hover:bg-error/10"
          >
            Disconnect
          </Button>
        ) : null}
        <Button
          type="submit"
          form="wordpress-connection-form"
          size="sm"
          loading={isSaving}
        >
          {isConnected ? "Save changes" : "Connect"}
        </Button>
      </CardFooter>
    </Card>
  );
}
