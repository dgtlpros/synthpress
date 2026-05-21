"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/atoms/Badge";
import { Button } from "@/components/atoms/Button";
import { Card } from "@/components/atoms/Card";
import { Label } from "@/components/atoms/Label";
import { Modal } from "@/components/atoms/Modal";
import { Textarea } from "@/components/atoms/Textarea";
import { cn } from "@/lib/cn";
import {
  type BlogSettingsTemplate,
  type BlogSettingsTemplateChangesPreview,
  buildBlogSettingsTemplateAiGuide,
  buildBlogSettingsTemplateAiGuideText,
} from "@/lib/blog-settings-template";

/**
 * Import / Export Card rendered on the Blog Settings page.
 *
 * Strictly presentational — the connector owns the import preview
 * state machine, the apply call, and the result handling. This
 * component only renders open modals, fires callbacks, and shows
 * the safety copy users need to see before clicking through.
 *
 * Two safety copy lines are NOT optional and tests assert their
 * presence:
 *   - the export modal says secrets are excluded;
 *   - the import preview says autopilot will stay disabled.
 */
export interface BlogSettingsImportExportImportState {
  /** Phase the import modal is in. */
  phase: "idle" | "reviewing" | "applying" | "applied" | "error";
  /** Parsed + normalized template; present once `phase === "reviewing"`. */
  preview?: {
    template: BlogSettingsTemplate;
    changes: BlogSettingsTemplateChangesPreview;
    warnings: string[];
  };
  /** Top-level error from parse or apply. */
  errorMessage?: string | null;
  /** Warnings returned from the apply step (post-success). */
  appliedWarnings?: string[];
}

export interface BlogSettingsImportExportProps {
  /** Pre-rendered pretty JSON for the destination blog's current settings. */
  exportTemplateJson: string;

  /** Open / close state for the export modal. */
  exportModalOpen: boolean;
  onOpenExportModal: () => void;
  onCloseExportModal: () => void;

  /** Open / close state for the import modal. */
  importModalOpen: boolean;
  onOpenImportModal: () => void;
  onCloseImportModal: () => void;

  /** Current text in the import textarea (controlled by the connector). */
  importTextareaValue: string;
  onImportTextareaChange: (value: string) => void;

  /**
   * Called when the user clicks "Review import". The connector parses
   * the JSON, builds a preview, and updates `importState`.
   */
  onReviewImport: () => void;

  /**
   * Called when the user clicks "Apply settings". The connector
   * runs the import server action and updates `importState`.
   */
  onApplyImport: (options: {
    includeBlogIdentity: boolean;
    includeAutomation: boolean;
  }) => void;

  /** Phase + preview/error state driven by the connector's controller hook. */
  importState: BlogSettingsImportExportImportState;

  /** Optional className for the outer Card. */
  className?: string;

  /**
   * Optional AI-prompt hint topic. Defaults to the generic prompt.
   * Wired through so a future enhancement can populate it from the
   * blog's niche field automatically.
   */
  aiPromptTopic?: string;
}

const COPY = {
  exportButton: "Export settings JSON",
  importButton: "Import settings JSON",
  copyJson: "Copy JSON",
  copyAiPromptAndJson: "Copy AI prompt + JSON",
  downloadJson: "Download JSON",
  reviewImport: "Review import",
  applySettings: "Apply settings",
  exportSafetyLine:
    "Safe to share with AI. Does not include WordPress credentials or secrets.",
  aiGuideHelp:
    "Use this when asking ChatGPT or Claude to adapt settings. It includes allowed enum values, MVP-active vs legacy field notes, and the safety rules import enforces.",
  importAutopilotWarning:
    "Imported settings do not automatically turn on autopilot. Review and enable autopilot when ready.",
  importWpWarning:
    "WordPress credentials are never imported. Connect WordPress separately in the Connections tab.",
} as const;

export function BlogSettingsImportExport({
  exportTemplateJson,
  exportModalOpen,
  onOpenExportModal,
  onCloseExportModal,
  importModalOpen,
  onOpenImportModal,
  onCloseImportModal,
  importTextareaValue,
  onImportTextareaChange,
  onReviewImport,
  onApplyImport,
  importState,
  className,
  aiPromptTopic,
}: BlogSettingsImportExportProps) {
  // Each copy button gets its own state so a "Copied!" badge on
  // one button doesn't visually replace the label of the other.
  const [copyJsonStatus, setCopyJsonStatus] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const [copyAiStatus, setCopyAiStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  // Defaulting to the "safe" import posture: never overwrite blog
  // identity unless the user opts in; do import automation cadence
  // (but the server action forces `enabled=false` regardless).
  const [includeBlogIdentity, setIncludeBlogIdentity] = useState(false);
  const [includeAutomation, setIncludeAutomation] = useState(true);

  // The guide TEXT (no JSON) renders in the textarea so the user
  // can scan / hand-edit it; the combined `aiGuideWithJson` is what
  // the "Copy AI prompt + JSON" button writes to the clipboard.
  // Two memos (not one + a slice) so a future "Copy guide only"
  // affordance can hook into the same value cheaply.
  const aiGuideText = useMemo(
    () => buildBlogSettingsTemplateAiGuideText({ topic: aiPromptTopic }),
    [aiPromptTopic],
  );
  const aiGuideWithJson = useMemo(
    () =>
      buildBlogSettingsTemplateAiGuide({
        templateJson: exportTemplateJson,
        topic: aiPromptTopic,
      }),
    [aiPromptTopic, exportTemplateJson],
  );

  async function handleCopyJson() {
    try {
      await navigator.clipboard.writeText(exportTemplateJson);
      setCopyJsonStatus("copied");
      window.setTimeout(() => setCopyJsonStatus("idle"), 1500);
    } catch {
      setCopyJsonStatus("error");
    }
  }

  async function handleCopyAiPromptAndJson() {
    try {
      await navigator.clipboard.writeText(aiGuideWithJson);
      setCopyAiStatus("copied");
      window.setTimeout(() => setCopyAiStatus("idle"), 1500);
    } catch {
      setCopyAiStatus("error");
    }
  }

  function handleDownload() {
    const blob = new Blob([exportTemplateJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "blog-settings-template.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Card className={cn("space-y-4", className)}>
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">
          Import / export settings
        </h2>
        <p className="text-sm text-muted">
          Clone this blog&apos;s personality, strategy, SEO, automation and
          publishing defaults to another blog — or paste in JSON you (or an AI)
          prepared. WordPress credentials and autopilot pause state are never
          copied.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={onOpenExportModal}>
          {COPY.exportButton}
        </Button>
        <Button type="button" variant="secondary" onClick={onOpenImportModal}>
          {COPY.importButton}
        </Button>
      </div>

      {/* ─── Export modal ─────────────────────────────────────── */}
      <Modal
        open={exportModalOpen}
        onClose={onCloseExportModal}
        title="Export settings JSON"
        description="Pretty-printed JSON describing this blog's personality, content strategy, SEO, automation and publishing defaults."
        maxWidth="xl"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onCloseExportModal}>
              Close
            </Button>
            <Button type="button" variant="secondary" onClick={handleDownload}>
              {COPY.downloadJson}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleCopyAiPromptAndJson}
              aria-live="polite"
            >
              {copyAiStatus === "copied" ? "Copied!" : COPY.copyAiPromptAndJson}
            </Button>
            <Button type="button" onClick={handleCopyJson} aria-live="polite">
              {copyJsonStatus === "copied" ? "Copied!" : COPY.copyJson}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">{COPY.exportSafetyLine}</p>

          <div>
            <Label htmlFor="blog-settings-template-export">
              Exported template JSON
            </Label>
            <Textarea
              id="blog-settings-template-export"
              value={exportTemplateJson}
              readOnly
              rows={16}
              className="mt-1 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>

          <div>
            <Label htmlFor="blog-settings-template-prompt">
              Prompt for AI (optional)
            </Label>
            <Textarea
              id="blog-settings-template-prompt"
              value={aiGuideText}
              readOnly
              rows={12}
              className="mt-1 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <p className="mt-1 text-xs text-muted">{COPY.aiGuideHelp}</p>
          </div>

          {copyJsonStatus === "error" || copyAiStatus === "error" ? (
            <p className="text-sm text-error">
              Could not copy to clipboard. Use Download JSON instead.
            </p>
          ) : null}
        </div>
      </Modal>

      {/* ─── Import modal ─────────────────────────────────────── */}
      <Modal
        open={importModalOpen}
        onClose={onCloseImportModal}
        title="Import settings JSON"
        description="Paste a SynthPress Blog Settings template. Review what will change before applying."
        maxWidth="xl"
        footer={renderImportFooter()}
      >
        {renderImportBody()}
      </Modal>
    </Card>
  );

  function renderImportFooter() {
    if (importState.phase === "applied") {
      return (
        <Button type="button" onClick={onCloseImportModal}>
          Close
        </Button>
      );
    }
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          onClick={onCloseImportModal}
          disabled={importState.phase === "applying"}
        >
          Cancel
        </Button>
        {importState.phase === "reviewing" || importState.phase === "error" ? (
          <Button type="button" variant="secondary" onClick={onReviewImport}>
            Re-review
          </Button>
        ) : null}
        {importState.phase === "reviewing" ? (
          <Button
            type="button"
            onClick={() =>
              onApplyImport({ includeBlogIdentity, includeAutomation })
            }
            loading={false}
          >
            {COPY.applySettings}
          </Button>
        ) : importState.phase === "applying" ? (
          <Button type="button" loading>
            Applying…
          </Button>
        ) : (
          <Button type="button" onClick={onReviewImport}>
            {COPY.reviewImport}
          </Button>
        )}
      </>
    );
  }

  function renderImportBody() {
    if (importState.phase === "applied") {
      return (
        <div className="space-y-3">
          <p className="text-sm text-success">
            Settings imported successfully.
          </p>
          {importState.appliedWarnings &&
          importState.appliedWarnings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              {importState.appliedWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-sm text-muted">{COPY.importAutopilotWarning}</p>
        </div>
      );
    }

    if (
      importState.phase === "reviewing" ||
      (importState.phase === "applying" && importState.preview)
    ) {
      const { template, changes, warnings } = importState.preview!;
      return (
        <div className="space-y-4">
          <ImportPreview
            template={template}
            changes={changes}
            warnings={warnings}
            includeBlogIdentity={includeBlogIdentity}
            onIncludeBlogIdentityChange={setIncludeBlogIdentity}
            includeAutomation={includeAutomation}
            onIncludeAutomationChange={setIncludeAutomation}
            disabled={importState.phase === "applying"}
          />
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Paste JSON exported from another SynthPress blog (or generated by AI).
          We&apos;ll validate the shape and show you what will change before
          anything is saved.
        </p>
        <div>
          <Label htmlFor="blog-settings-template-import">
            Paste template JSON
          </Label>
          <Textarea
            id="blog-settings-template-import"
            value={importTextareaValue}
            onChange={(e) => onImportTextareaChange(e.target.value)}
            rows={14}
            placeholder='{ "kind": "synthpress.blogSettingsTemplate", "schemaVersion": 1, ... }'
            className="mt-1 font-mono text-xs"
          />
        </div>
        {importState.phase === "error" && importState.errorMessage ? (
          <p className="text-sm text-error" role="alert">
            {importState.errorMessage}
          </p>
        ) : null}
      </div>
    );
  }
}

function ImportPreview({
  template,
  changes,
  warnings,
  includeBlogIdentity,
  onIncludeBlogIdentityChange,
  includeAutomation,
  onIncludeAutomationChange,
  disabled,
}: {
  template: BlogSettingsTemplate;
  changes: BlogSettingsTemplateChangesPreview;
  warnings: string[];
  includeBlogIdentity: boolean;
  onIncludeBlogIdentityChange: (next: boolean) => void;
  includeAutomation: boolean;
  onIncludeAutomationChange: (next: boolean) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="brand">schemaVersion {template.schemaVersion}</Badge>
          <span className="text-xs text-muted">{template.kind}</span>
          {template.exportedAt ? (
            <span className="text-xs text-muted">
              · exported {template.exportedAt}
            </span>
          ) : null}
        </div>
      </div>

      {template.blog ? (
        <section className="rounded-[var(--sp-radius-lg)] border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">
            Blog identity (in template)
          </h3>
          <dl className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2">
            {template.blog.name !== undefined ? (
              <Pair label="Name" value={template.blog.name} />
            ) : null}
            {template.blog.description !== undefined ? (
              <Pair label="Description" value={template.blog.description} />
            ) : null}
            {template.blog.niche !== undefined ? (
              <Pair label="Niche" value={template.blog.niche} />
            ) : null}
            {template.blog.keywords !== undefined ? (
              <Pair
                label="Keywords"
                value={template.blog.keywords.join(", ")}
              />
            ) : null}
          </dl>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeBlogIdentity}
              onChange={(e) => onIncludeBlogIdentityChange(e.target.checked)}
              disabled={disabled}
            />
            <span>
              Also overwrite this blog&apos;s name / description / niche /
              keywords / prompt template
            </span>
          </label>
        </section>
      ) : null}

      <section className="rounded-[var(--sp-radius-lg)] border border-border p-3">
        <h3 className="text-sm font-semibold text-foreground">
          Settings sections that will change
        </h3>
        {changes.settingsSectionsChanged.length === 0 ? (
          <p className="mt-1 text-xs text-muted">
            None — the template matches the destination blog&apos;s current
            settings.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {changes.settingsSectionsChanged.map((s) => (
              <li key={s}>
                <Badge variant="default">{s}</Badge>
              </li>
            ))}
          </ul>
        )}
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeAutomation}
            onChange={(e) => onIncludeAutomationChange(e.target.checked)}
            disabled={disabled}
          />
          <span>
            Include automation cadence (autopilot stays disabled either way)
          </span>
        </label>
      </section>

      <section className="rounded-[var(--sp-radius-lg)] border border-border p-3">
        <h3 className="text-sm font-semibold text-foreground">Safety</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted">
          <li>{COPY.importAutopilotWarning}</li>
          <li>{COPY.importWpWarning}</li>
        </ul>
        {warnings.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-warning">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="font-medium text-foreground">{label}</dt>
      <dd className="truncate">{value || <em>(empty)</em>}</dd>
    </div>
  );
}
