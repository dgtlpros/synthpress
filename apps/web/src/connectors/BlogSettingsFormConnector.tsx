"use client";

import {
  BlogSettingsTabs,
  type BlogSettingsTabsValue,
} from "@/components/organisms/BlogSettingsTabs";
import { useBlogSettingsForm } from "@/hooks/useBlogSettingsForm";

export interface BlogSettingsFormConnectorProps {
  teamId: string;
  projectId: string;
  blogId: string;
  initialValue: BlogSettingsTabsValue;
}

export function BlogSettingsFormConnector({
  teamId,
  projectId,
  blogId,
  initialValue,
}: BlogSettingsFormConnectorProps) {
  const { save, isSaving, error, saveSuccess } = useBlogSettingsForm({
    teamId,
    projectId,
    blogId,
    initialValue,
  });

  return (
    <BlogSettingsTabs
      initialValue={initialValue}
      onSave={save}
      isSaving={isSaving}
      error={error}
      saveSuccess={saveSuccess}
    />
  );
}
