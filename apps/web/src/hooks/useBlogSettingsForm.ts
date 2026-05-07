"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBlog, type UpdateBlogInput } from "@/actions/workspace";
import type { BlogSettingsTabsValue } from "@/components/organisms/BlogSettingsTabs";

export interface UseBlogSettingsFormOptions {
  teamId: string;
  projectId: string;
  blogId: string;
  initialValue: BlogSettingsTabsValue;
}

export interface UseBlogSettingsFormResult {
  initialValue: BlogSettingsTabsValue;
  save: (next: BlogSettingsTabsValue) => void;
  isSaving: boolean;
  error: string | null;
  saveSuccess: boolean;
}

function parseKeywords(text: string): string[] {
  return text
    .split(/[,\n]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Diff the current form value against the initial value and produce a
 * minimal {@link UpdateBlogInput} payload. Only fields that actually changed
 * are included so the server action can short-circuit no-op updates.
 */
function diff(
  initial: BlogSettingsTabsValue,
  next: BlogSettingsTabsValue,
): UpdateBlogInput {
  const out: UpdateBlogInput = {};

  if (next.general.name !== initial.general.name) {
    out.name = next.general.name;
  }
  if (next.general.description !== initial.general.description) {
    out.description = next.general.description;
  }
  if (next.general.niche !== initial.general.niche) {
    out.niche = next.general.niche;
  }
  if (next.general.keywordsText !== initial.general.keywordsText) {
    out.keywords = parseKeywords(next.general.keywordsText);
  }
  if (next.general.aiPromptTemplate !== initial.general.aiPromptTemplate) {
    out.aiPromptTemplate = next.general.aiPromptTemplate;
  }

  if (next.cadence.isActive !== initial.cadence.isActive) {
    out.isActive = next.cadence.isActive;
  }
  if (next.cadence.articlesPerDay !== initial.cadence.articlesPerDay) {
    out.articlesPerDay = next.cadence.articlesPerDay;
  }
  if (next.cadence.scheduleCron !== initial.cadence.scheduleCron) {
    out.scheduleCron = next.cadence.scheduleCron;
  }

  // Settings: deep-compare per section and only ship the sections that changed.
  const settingsPatch: UpdateBlogInput["settings"] = {};
  let anySettingsChange = false;
  for (const section of Object.keys(next.settings) as Array<
    keyof typeof next.settings
  >) {
    if (
      JSON.stringify(next.settings[section]) !==
      JSON.stringify(initial.settings[section])
    ) {
      settingsPatch[section] = next.settings[section];
      anySettingsChange = true;
    }
  }
  if (anySettingsChange) out.settings = settingsPatch;

  return out;
}

export function useBlogSettingsForm({
  teamId,
  projectId,
  blogId,
  initialValue,
}: UseBlogSettingsFormOptions): UseBlogSettingsFormResult {
  const router = useRouter();
  const [isSaving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const save = useCallback(
    (next: BlogSettingsTabsValue) => {
      setError(null);
      setSaveSuccess(false);
      const payload = diff(initialValue, next);
      if (Object.keys(payload).length === 0) {
        setSaveSuccess(true);
        return;
      }
      startSave(async () => {
        const result = await updateBlog(teamId, projectId, blogId, payload);
        if (result.error) {
          setError(result.error);
          return;
        }
        setSaveSuccess(true);
        router.refresh();
      });
    },
    [router, teamId, projectId, blogId, initialValue],
  );

  return { initialValue, save, isSaving, error, saveSuccess };
}
