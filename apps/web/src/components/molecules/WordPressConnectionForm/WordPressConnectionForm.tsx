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
import { WordPressConnectionPackageImporter } from "@/components/molecules/WordPressConnectionPackageImporter";
import type { WordPressConnectionTestResult } from "@/lib/wordpress-connection-test-types";

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
  /**
   * Called when the user clicks "Test connection". The parent
   * triggers the server action; the form just renders the result
   * panel based on the props below. Optional — if omitted, the
   * button is hidden.
   */
  onTestConnection?: () => void;
  isSaving?: boolean;
  isDisconnecting?: boolean;
  /** Spinner state on the "Test connection" button. */
  isTesting?: boolean;
  /**
   * Result of the most recent test. `null` means the user hasn't
   * tested yet (or has reset). The form shows a coloured panel
   * for `ok: true` (with warnings) or `ok: false` (with friendly
   * error copy).
   */
  testResult?: WordPressConnectionTestResult | null;
  /**
   * Action-layer error (e.g. "Blog not found.", "You must be
   * signed in."). Shown above the test result panel — separate
   * from `error` because save vs. test failures don't share copy.
   */
  testActionError?: string | null;
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
  onTestConnection,
  isSaving,
  isDisconnecting,
  isTesting,
  testResult,
  testActionError,
  error,
  className,
}: WordPressConnectionFormProps) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [username, setUsername] = useState(initialUsername ?? "");
  const [appPassword, setAppPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const isConnected = Boolean(initialUrl && initialUsername);
  // We can only test what's persisted server-side — the action
  // reads the row, the client never re-sends the application
  // password. So the button is gated on the same condition the
  // "Connected" badge uses, plus a stored password.
  const canTest = isConnected && hasStoredPassword;

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

  /**
   * Pulled in from the importer molecule. We deliberately
   * *don't* call `onSubmit` here — the user still has to paste
   * their Application Password and click Save. The notice line
   * tells them exactly that.
   */
  function applyImportedPackage(input: { wpUrl: string; wpUsername?: string }) {
    setLocalError(null);
    setUrl(input.wpUrl);
    if (input.wpUsername !== undefined) {
      setUsername(input.wpUsername);
      setImportNotice(
        "Filled site URL and username. Paste the Application Password from WordPress, then click Save changes.",
      );
    } else {
      setImportNotice(
        "Filled site URL. Choose an Editor-capable WordPress username, paste the Application Password, then click Save changes.",
      );
    }
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
        <WordPressConnectionPackageImporter
          currentUrl={url}
          currentUsername={username}
          onApply={applyImportedPackage}
          disabled={isSaving}
          className="mb-4"
        />

        {importNotice ? (
          <p
            className="mb-4 rounded-[var(--sp-radius-md)] border border-success/40 bg-success/10 px-3 py-2 text-xs text-foreground"
            role="status"
            data-testid="wp-import-notice"
          >
            {importNotice}
          </p>
        ) : null}

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

        {onTestConnection ? (
          <ConnectionTestPanel
            canTest={canTest}
            isTesting={Boolean(isTesting)}
            testResult={testResult ?? null}
            testActionError={testActionError ?? null}
            onTestConnection={onTestConnection}
          />
        ) : null}
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

interface ConnectionTestPanelProps {
  canTest: boolean;
  isTesting: boolean;
  testResult: WordPressConnectionTestResult | null;
  testActionError: string | null;
  onTestConnection: () => void;
}

/**
 * Renders the "Test connection" affordance below the form fields.
 * Three visual states:
 *   * idle / before-test → just the button + helper line.
 *   * action_error → red banner from the server action (e.g. RLS
 *     hid the row). Distinct from helper errors because there are
 *     no credentials involved yet.
 *   * helper result → green panel on success (with optional yellow
 *     warning list), red panel on failure (with friendly copy).
 *
 * The button is disabled until the blog has both a URL/username
 * AND a stored password — there's nothing to test against
 * otherwise, and showing a disabled button + helper line beats
 * letting the user fire the action just to see "Enter your
 * Application Password." come back.
 */
function ConnectionTestPanel({
  canTest,
  isTesting,
  testResult,
  testActionError,
  onTestConnection,
}: ConnectionTestPanelProps) {
  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Test connection</p>
          <p className="text-xs text-muted">
            Sends a one-off GET to{" "}
            <span className="font-mono">/wp-json/wp/v2/users/me</span> with the
            saved credentials. Save changes first if you&apos;ve edited the
            fields above.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={isTesting}
          disabled={!canTest}
          onClick={onTestConnection}
        >
          Test connection
        </Button>
      </div>

      {testActionError ? (
        <p
          className="mt-3 rounded-[var(--sp-radius-md)] border border-error/40 bg-error/10 px-3 py-2 text-sm text-error"
          role="alert"
        >
          {testActionError}
        </p>
      ) : null}

      {testResult ? <ConnectionTestResultPanel result={testResult} /> : null}
    </div>
  );
}

function ConnectionTestResultPanel({
  result,
}: {
  result: WordPressConnectionTestResult;
}) {
  if (!result.ok) {
    return (
      <div
        className="mt-3 rounded-[var(--sp-radius-md)] border border-error/40 bg-error/10 px-3 py-2 text-sm text-error"
        role="alert"
        data-testid="wp-test-result-error"
      >
        <p className="font-medium">Connection failed</p>
        <p className="mt-1 text-error/90">{result.error?.message}</p>
      </div>
    );
  }

  const displayName = result.user?.name?.trim() || result.user?.slug || null;
  const hasWarnings = result.warnings.length > 0;

  return (
    <div
      className={
        hasWarnings
          ? "mt-3 rounded-[var(--sp-radius-md)] border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground"
          : "mt-3 rounded-[var(--sp-radius-md)] border border-success/40 bg-success/10 px-3 py-2 text-sm text-foreground"
      }
      role="status"
      data-testid="wp-test-result-success"
    >
      <p className="font-medium">
        {hasWarnings ? "Connected with warnings" : "Connection looks healthy"}
      </p>
      <p className="mt-1 text-muted">
        {displayName
          ? `Connected as ${displayName}. REST API is reachable.`
          : "REST API is reachable."}
      </p>
      {result.user?.roles?.length ? (
        <p className="mt-1 text-xs text-muted">
          WordPress role{result.user.roles.length === 1 ? "" : "s"}:{" "}
          <span className="font-mono">{result.user.roles.join(", ")}</span>
        </p>
      ) : null}
      {hasWarnings ? (
        <ul
          className="mt-2 list-disc space-y-1 pl-5 text-xs text-foreground"
          data-testid="wp-test-result-warnings"
        >
          {result.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
