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
  /**
   * `true` iff the blog has all three WordPress credential fields
   * stored. Computed in the parent server component so we don't
   * re-query Supabase from the client. Used to gate the Publishing
   * tab's "auto-send to WP draft" toggle.
   */
  hasWordPressConnection?: boolean;
}

export function BlogSettingsFormConnector({
  teamId,
  projectId,
  blogId,
  initialValue,
  hasWordPressConnection,
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
      hasWordPressConnection={hasWordPressConnection}
    />
  );
}
