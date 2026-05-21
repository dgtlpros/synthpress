"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importBlogSettingsTemplate } from "@/actions/blog-settings-template";
import {
  type BlogSettings,
  type BlogSettingsTemplate,
  type BlogSettingsTemplateBlogIdentity,
  type BlogSettingsTemplateChangesPreview,
  buildBlogSettingsTemplateChangesPreview,
  parseBlogSettingsTemplateJson,
} from "@/lib/blog-settings-template";
import type { BlogSettingsImportExportImportState } from "@/components/molecules/BlogSettingsImportExport";

export interface UseBlogSettingsImportExportOptions {
  teamId: string;
  projectId: string;
  blogId: string;
  /**
   * Snapshot of the destination blog used by the "what will change"
   * preview. Doesn't need to be reactive — the connector reads it
   * from the page-level Server Component once per mount and the
   * preview re-computes on every Review click anyway.
   */
  current: {
    blog: BlogSettingsTemplateBlogIdentity;
    settings: BlogSettings;
  };
}

export interface UseBlogSettingsImportExportResult {
  exportModalOpen: boolean;
  openExportModal: () => void;
  closeExportModal: () => void;

  importModalOpen: boolean;
  openImportModal: () => void;
  closeImportModal: () => void;

  importTextareaValue: string;
  setImportTextareaValue: (value: string) => void;

  importState: BlogSettingsImportExportImportState;

  reviewImport: () => void;
  applyImport: (options: {
    includeBlogIdentity: boolean;
    includeAutomation: boolean;
  }) => void;
}

/**
 * Controller hook for the {@link BlogSettingsImportExport} molecule.
 *
 * Owns:
 *   - open/close state for both modals;
 *   - the import textarea value;
 *   - the parse-+-preview state machine (`idle → reviewing → applying → applied | error`);
 *   - the call to {@link importBlogSettingsTemplate} on apply, with
 *     `router.refresh()` afterward so the settings page re-reads the
 *     updated blog row through its Server Component.
 *
 * Does NOT own:
 *   - the export JSON (pre-rendered server-side; passed into the
 *     connector as a prop);
 *   - the destination-blog snapshot (also a prop from the page).
 */
export function useBlogSettingsImportExport({
  teamId,
  projectId,
  blogId,
  current,
}: UseBlogSettingsImportExportOptions): UseBlogSettingsImportExportResult {
  const router = useRouter();
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importTextareaValue, setImportTextareaValue] = useState("");
  const [importState, setImportState] =
    useState<BlogSettingsImportExportImportState>({ phase: "idle" });
  const [, startApply] = useTransition();

  const openExportModal = useCallback(() => setExportModalOpen(true), []);
  const closeExportModal = useCallback(() => setExportModalOpen(false), []);

  const openImportModal = useCallback(() => {
    setImportModalOpen(true);
    setImportTextareaValue("");
    setImportState({ phase: "idle" });
  }, []);

  const closeImportModal = useCallback(() => {
    setImportModalOpen(false);
    // Reset for next open. Done on close (not open) so that mid-flow
    // states render correctly if the user re-opens without clearing.
    setImportState({ phase: "idle" });
    setImportTextareaValue("");
  }, []);

  const reviewImport = useCallback(() => {
    const parsed = parseBlogSettingsTemplateJson(importTextareaValue);
    if (!parsed.ok) {
      setImportState({
        phase: "error",
        errorMessage: parsed.error.message,
      });
      return;
    }
    const preview: {
      template: BlogSettingsTemplate;
      changes: BlogSettingsTemplateChangesPreview;
      warnings: string[];
    } = {
      template: parsed.normalizedTemplate,
      changes: buildBlogSettingsTemplateChangesPreview(
        parsed.normalizedTemplate,
        current,
      ),
      warnings: parsed.warnings,
    };
    setImportState({ phase: "reviewing", preview });
  }, [importTextareaValue, current]);

  const applyImport = useCallback(
    (options: { includeBlogIdentity: boolean; includeAutomation: boolean }) => {
      // Snapshot the preview into the applying state so the modal can
      // keep rendering the same "what will change" summary while the
      // server action runs.
      setImportState((prev) =>
        prev.phase === "reviewing" || prev.phase === "applying"
          ? { ...prev, phase: "applying" }
          : prev,
      );
      startApply(async () => {
        const result = await importBlogSettingsTemplate({
          teamId,
          projectId,
          blogId,
          templateJson: importTextareaValue,
          options,
        });
        if (result.error) {
          setImportState({
            phase: "error",
            errorMessage: result.error,
          });
          return;
        }
        setImportState({
          phase: "applied",
          appliedWarnings: result.data?.warnings ?? [],
        });
        router.refresh();
      });
    },
    [teamId, projectId, blogId, importTextareaValue, router],
  );

  return {
    exportModalOpen,
    openExportModal,
    closeExportModal,

    importModalOpen,
    openImportModal,
    closeImportModal,

    importTextareaValue,
    setImportTextareaValue,

    importState,

    reviewImport,
    applyImport,
  };
}
