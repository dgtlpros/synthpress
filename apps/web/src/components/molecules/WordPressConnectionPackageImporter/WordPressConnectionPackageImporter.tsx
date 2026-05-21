"use client";

import { useId, useState } from "react";
import { Button } from "@/components/atoms/Button";
import { Label } from "@/components/atoms/Label";
import { Textarea } from "@/components/atoms/Textarea";
import { cn } from "@/lib/cn";
import {
  parseWordPressConnectionPackageJson,
  type WordPressConnectionPackage,
  type WordPressConnectionPackageParseError,
  type WordPressConnectionPackageReadinessRow,
} from "@/lib/wordpress-connection-package";

/**
 * "Import connection package" section of the WordPress Connections
 * tab.
 *
 * Owns the paste → review → use-this-connection flow:
 *   1. Idle: the textarea is collapsed behind a "Paste connection
 *      package" button. Keeps the form short for users who don't
 *      have the companion plugin.
 *   2. Editing: textarea visible. User pastes JSON and clicks
 *      "Review package".
 *   3. Reviewing: parsed-out details + readiness rows are rendered.
 *      User clicks "Use this connection" to push site URL + bot
 *      login into the parent form, OR "Cancel" to discard.
 *   4. Error: parser failure copy with a "Try again" affordance.
 *
 * Apply rules:
 *   * Only `site.url` and `recommendedUser.login` reach the parent.
 *     Everything else (admin URL, REST URL, readiness rows) is
 *     preview-only.
 *   * **Never** touches the Application Password — that field stays
 *     under the user's exclusive control.
 *   * If the current form already has a URL or username that
 *     differs, we surface an "overwrites your edits" notice and
 *     still require the explicit click — the click is the
 *     confirmation.
 */

export interface WordPressConnectionPackageImporterProps {
  /** Current URL in the parent form (used to detect overwrites). */
  currentUrl: string;
  /** Current username in the parent form (used to detect overwrites). */
  currentUsername: string;
  /**
   * Called when the user clicks "Use this connection". The parent
   * decides whether to fill / overwrite each field. Application
   * Password is intentionally absent from this payload.
   */
  onApply: (input: { wpUrl: string; wpUsername?: string }) => void;
  /** When true, the entire importer is disabled (parent saving). */
  disabled?: boolean;
  className?: string;
}

type ImportPhase =
  | { kind: "idle" }
  | { kind: "editing"; rawJson: string }
  | {
      kind: "reviewing";
      rawJson: string;
      package: WordPressConnectionPackage;
      warnings: string[];
    }
  | {
      kind: "error";
      rawJson: string;
      error: WordPressConnectionPackageParseError;
    };

export function WordPressConnectionPackageImporter({
  currentUrl,
  currentUsername,
  onApply,
  disabled,
  className,
}: WordPressConnectionPackageImporterProps) {
  const [phase, setPhase] = useState<ImportPhase>({ kind: "idle" });
  const textareaId = useId();

  function reveal() {
    /* v8 ignore next 3 -- defensive: the "Paste connection package"
       button is only rendered in `idle`, so this guard only fires
       against a future refactor that wires reveal() elsewhere. */
    if (phase.kind !== "idle") return;
    setPhase({ kind: "editing", rawJson: "" });
  }

  function onRawJsonChange(next: string) {
    // Any change to the textarea drops us into `editing`, which
    // intentionally clears the cached `parsed` result + parser
    // error. Editing after a successful review re-arms the state —
    // the user must click Review again before "Use this connection"
    // is offered for the new text. The `idle` phase is unreachable
    // here because the textarea isn't rendered until reveal() runs.
    setPhase({ kind: "editing", rawJson: next });
  }

  function review() {
    /* v8 ignore next 3 -- defensive: the "Review package" button is
       only rendered in editing/reviewing/error, never in idle. */
    if (phase.kind === "idle") return;
    const result = parseWordPressConnectionPackageJson(phase.rawJson);
    if (!result.ok) {
      setPhase({
        kind: "error",
        rawJson: phase.rawJson,
        error: result.error,
      });
      return;
    }
    setPhase({
      kind: "reviewing",
      rawJson: phase.rawJson,
      package: result.package,
      warnings: result.warnings,
    });
  }

  function apply() {
    /* v8 ignore next 3 -- defensive: the "Use this connection"
       button is only rendered in `reviewing`. The early-return
       protects against a future refactor that wires apply()
       elsewhere. The test "apply is a no-op when called before
       review()" covers that the apply button is in fact absent
       outside the reviewing phase. */
    if (phase.kind !== "reviewing") return;
    onApply({
      wpUrl: phase.package.site.url,
      // Suggest the bot login as the username, but only when the
      // plugin actually marked it as existing — otherwise the user
      // would have to delete it before saving (no point pre-filling
      // a username that doesn't exist in WordPress yet).
      wpUsername:
        phase.package.recommendedUser?.exists === true
          ? phase.package.recommendedUser.login
          : undefined,
    });
    setPhase({ kind: "idle" });
  }

  function reset() {
    setPhase({ kind: "idle" });
  }

  if (phase.kind === "idle") {
    return (
      <section
        className={cn(
          "rounded-[var(--sp-radius-lg)] border border-border bg-surface px-4 py-3",
          className,
        )}
        aria-labelledby="wp-import-heading"
      >
        <h3
          id="wp-import-heading"
          className="text-sm font-semibold text-foreground"
        >
          Import connection package
        </h3>
        <p className="mt-1 text-xs text-muted">
          Install the SynthPress plugin on WordPress, copy the connection
          package from Settings → SynthPress, then paste it here. You will still
          paste the Application Password separately.
        </p>
        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={reveal}
            disabled={disabled}
          >
            Paste connection package
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(
        "rounded-[var(--sp-radius-lg)] border border-border bg-surface px-4 py-3",
        className,
      )}
      aria-labelledby="wp-import-heading"
    >
      <h3
        id="wp-import-heading"
        className="text-sm font-semibold text-foreground"
      >
        Import connection package
      </h3>
      <p className="mt-1 text-xs text-muted">
        Paste the JSON exported by Settings → SynthPress in your WordPress
        admin. We&apos;ll show you a preview before anything fills the form.
      </p>

      <div className="mt-3">
        <Label htmlFor={textareaId}>Connection package JSON</Label>
        <Textarea
          id={textareaId}
          value={phase.rawJson}
          onChange={(e) => onRawJsonChange(e.target.value)}
          placeholder='{"kind":"synthpress.wordpressConnection", ...}'
          rows={6}
          disabled={disabled}
          spellCheck={false}
          className="mt-1 font-mono text-xs"
          data-testid="wp-import-textarea"
          error={phase.kind === "error"}
        />
      </div>

      {phase.kind === "error" ? (
        <p
          className="mt-2 rounded-[var(--sp-radius-md)] border border-error/40 bg-error/10 px-3 py-2 text-sm text-error"
          role="alert"
        >
          {phase.error.message}
        </p>
      ) : null}

      {phase.kind === "reviewing" ? (
        <PackagePreview
          parsedPackage={phase.package}
          warnings={phase.warnings}
          currentUrl={currentUrl}
          currentUsername={currentUsername}
        />
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {phase.kind === "reviewing" ? (
          <>
            <Button type="button" size="sm" onClick={apply} disabled={disabled}>
              Use this connection
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={reset}
              disabled={disabled}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              onClick={review}
              disabled={disabled}
            >
              Review package
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={reset}
              disabled={disabled}
            >
              Cancel
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

interface PackagePreviewProps {
  parsedPackage: WordPressConnectionPackage;
  warnings: string[];
  currentUrl: string;
  currentUsername: string;
}

function PackagePreview({
  parsedPackage,
  warnings,
  currentUrl,
  currentUsername,
}: PackagePreviewProps) {
  const recommendedLogin = parsedPackage.recommendedUser?.login;
  const recommendedExists = parsedPackage.recommendedUser?.exists === true;
  const willOverwriteUrl =
    currentUrl.trim() !== "" && currentUrl.trim() !== parsedPackage.site.url;
  const willOverwriteUsername =
    recommendedExists &&
    recommendedLogin !== undefined &&
    currentUsername.trim() !== "" &&
    currentUsername.trim() !== recommendedLogin;

  const readiness = parsedPackage.readiness ?? [];
  const failingReadiness = readiness.some((row) => row.status === "fail");

  return (
    <div
      className="mt-3 space-y-3 rounded-[var(--sp-radius-md)] border border-border bg-background px-3 py-3"
      data-testid="wp-import-preview"
    >
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <PreviewRow label="Site name" value={parsedPackage.site.name} />
        <PreviewRow label="Site URL" value={parsedPackage.site.url} isMono />
        <PreviewRow
          label="REST URL"
          value={parsedPackage.site.restUrl}
          isMono
        />
        <PreviewRow
          label="WordPress"
          value={parsedPackage.site.wordpressVersion}
        />
        <PreviewRow
          label="Plugin"
          value={
            parsedPackage.plugin?.version
              ? `v${parsedPackage.plugin.version}`
              : parsedPackage.plugin?.installed
                ? "Installed"
                : undefined
          }
        />
        <PreviewRow
          label="Recommended user"
          value={
            recommendedLogin && recommendedExists
              ? recommendedLogin
              : recommendedLogin
                ? `${recommendedLogin} (not found in WordPress)`
                : undefined
          }
          isMono={recommendedExists}
        />
      </dl>

      {readiness.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Readiness from WordPress
          </p>
          <ul className="mt-1 space-y-1" data-testid="wp-import-readiness-list">
            {readiness.map((row) => (
              <ReadinessRow key={row.key} row={row} />
            ))}
          </ul>
        </div>
      ) : null}

      {failingReadiness ? (
        <p
          className="rounded-[var(--sp-radius-md)] border border-error/40 bg-error/10 px-3 py-2 text-xs text-error"
          role="alert"
        >
          This site may need setup changes before publishing works. Fix the
          failing rows in WordPress and re-export the package.
        </p>
      ) : null}

      {parsedPackage.recommendedUser !== undefined &&
      parsedPackage.recommendedUser.exists === false ? (
        <p
          className="rounded-[var(--sp-radius-md)] border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground"
          role="status"
        >
          Create <span className="font-mono">synthpress-bot</span> in WordPress
          or use another Editor-capable username.
        </p>
      ) : null}

      {willOverwriteUrl || willOverwriteUsername ? (
        <p
          className="rounded-[var(--sp-radius-md)] border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground"
          role="status"
        >
          {willOverwriteUrl && willOverwriteUsername
            ? "This will overwrite the URL and username already in the form."
            : willOverwriteUrl
              ? "This will overwrite the URL already in the form."
              : "This will overwrite the username already in the form."}
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <ul
          className="list-disc space-y-1 pl-5 text-xs text-foreground"
          data-testid="wp-import-warnings"
        >
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-muted">
        After clicking <strong>Use this connection</strong>, paste the
        Application Password from WordPress and click{" "}
        <strong>Save changes</strong>. The package never contains the password.
      </p>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  isMono,
}: {
  label: string;
  value?: string;
  isMono?: boolean;
}) {
  if (value === undefined) return null;
  return (
    <>
      <dt className="text-xs text-muted">{label}</dt>
      <dd
        className={cn(
          "text-xs text-foreground",
          isMono ? "font-mono break-all" : "",
        )}
      >
        {value}
      </dd>
    </>
  );
}

function ReadinessRow({
  row,
}: {
  row: WordPressConnectionPackageReadinessRow;
}) {
  const { dotClass, ariaLabel } = readinessStatusVisuals(row.status);
  return (
    <li className="flex items-start gap-2 text-xs">
      <span
        className={cn(
          "mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full",
          dotClass,
        )}
        aria-label={ariaLabel}
        role="img"
      />
      <span className="flex-1">
        <span className="font-medium text-foreground">{row.label}</span>
        <span className="ml-1 text-muted">— {row.message}</span>
      </span>
    </li>
  );
}

function readinessStatusVisuals(
  status: WordPressConnectionPackageReadinessRow["status"],
): { dotClass: string; ariaLabel: string } {
  switch (status) {
    case "pass":
      return { dotClass: "bg-success", ariaLabel: "Pass" };
    case "warning":
      return { dotClass: "bg-warning", ariaLabel: "Warning" };
    case "fail":
      return { dotClass: "bg-error", ariaLabel: "Fail" };
  }
}
