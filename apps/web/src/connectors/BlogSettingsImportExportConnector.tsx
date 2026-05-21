"use client";

import { BlogSettingsImportExport } from "@/components/molecules/BlogSettingsImportExport";
import { useBlogSettingsImportExport } from "@/hooks/useBlogSettingsImportExport";
import type {
  BlogSettings,
  BlogSettingsTemplateBlogIdentity,
} from "@/lib/blog-settings-template";

export interface BlogSettingsImportExportConnectorProps {
  teamId: string;
  projectId: string;
  blogId: string;
  /** Pre-rendered export JSON for this blog, built server-side. */
  exportTemplateJson: string;
  /** Snapshot of the destination blog used for the import preview diff. */
  current: {
    blog: BlogSettingsTemplateBlogIdentity;
    settings: BlogSettings;
  };
  /**
   * Optional topic to inject into the "Prompt for AI" copy in the
   * export modal. Usually the blog's niche so the suggestion is
   * concrete out of the box.
   */
  aiPromptTopic?: string;
}

/**
 * Bridges the Server Component-provided template JSON + blog snapshot
 * into the {@link BlogSettingsImportExport} dumb molecule via the
 * {@link useBlogSettingsImportExport} controller hook.
 */
export function BlogSettingsImportExportConnector({
  teamId,
  projectId,
  blogId,
  exportTemplateJson,
  current,
  aiPromptTopic,
}: BlogSettingsImportExportConnectorProps) {
  const controller = useBlogSettingsImportExport({
    teamId,
    projectId,
    blogId,
    current,
  });

  return (
    <BlogSettingsImportExport
      exportTemplateJson={exportTemplateJson}
      exportModalOpen={controller.exportModalOpen}
      onOpenExportModal={controller.openExportModal}
      onCloseExportModal={controller.closeExportModal}
      importModalOpen={controller.importModalOpen}
      onOpenImportModal={controller.openImportModal}
      onCloseImportModal={controller.closeImportModal}
      importTextareaValue={controller.importTextareaValue}
      onImportTextareaChange={controller.setImportTextareaValue}
      onReviewImport={controller.reviewImport}
      onApplyImport={controller.applyImport}
      importState={controller.importState}
      aiPromptTopic={aiPromptTopic}
    />
  );
}
