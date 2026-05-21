"use server";

/**
 * Server actions for the Blog Settings Template feature — see
 * `lib/blog-settings-template.ts` for the JSON shape + pure helpers.
 *
 * Both actions reuse the existing `updateBlog` server action so that
 * RLS gating, slug regeneration, paused-metadata-clear, timezone
 * validation, and the cache revalidation paths stay in one place.
 * This file's job is to wrap that surface with template-aware
 * sanitization + a thin auth + JSON-load shim.
 */

import { createClient } from "@/lib/supabase/server";
import {
  type BlogSettings,
  type BlogAutomationSettings,
  loadBlogSettings,
} from "@/lib/blog-settings";
import {
  buildBlogSettingsTemplate,
  parseBlogSettingsTemplateJson,
  serializeBlogSettingsTemplate,
  type BlogSettingsTemplate,
} from "@/lib/blog-settings-template";
import {
  type ActionResult,
  type UpdateBlogInput,
  updateBlog,
} from "./workspace";

export interface ExportBlogSettingsTemplateInput {
  teamId: string;
  projectId: string;
  blogId: string;
}

export interface ExportBlogSettingsTemplateResult {
  templateJson: string;
  template: BlogSettingsTemplate;
}

/**
 * Export the destination blog's settings as a sanitized
 * {@link BlogSettingsTemplate} (pretty-printed JSON + the parsed
 * object for callers that don't want to re-parse).
 *
 * Auth:
 *   - The Server Component that renders the settings page already
 *     verifies team / project / blog access via RLS, so this action
 *     re-reads `blogs` through the user-context client. If the row
 *     isn't visible, we return `"Blog not found."` rather than
 *     leaking the existence of a hidden row.
 *
 * Sanitization (delegated to `buildBlogSettingsTemplate`):
 *   - drops WordPress credentials (they live on columns, never read here);
 *   - clears `automation.pausedAt / pausedReason / pausedMessage`;
 *   - normalizes the settings jsonb via `loadBlogSettings`.
 */
export async function exportBlogSettingsTemplate(
  input: ExportBlogSettingsTemplateInput,
): Promise<ActionResult<ExportBlogSettingsTemplateResult>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  const { data: blog, error } = await supabase
    .from("blogs")
    .select("name, description, niche, keywords, ai_prompt_template, settings")
    .eq("id", input.blogId)
    .eq("project_id", input.projectId)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }
  if (!blog) {
    return { data: null, error: "Blog not found." };
  }
  // teamId is part of the API surface for symmetry with importBlogSettingsTemplate
  // and the URL params on the settings page, but RLS on `blogs` is scoped via
  // `project_id` so we don't need to re-query the team here.
  void input.teamId;

  const settings = loadBlogSettings(blog.settings);
  const template = buildBlogSettingsTemplate({
    blog: {
      name: blog.name,
      description: blog.description ?? "",
      niche: blog.niche ?? "",
      keywords: blog.keywords ?? [],
      aiPromptTemplate: blog.ai_prompt_template ?? "",
    },
    settings,
  });

  return {
    data: {
      template,
      templateJson: serializeBlogSettingsTemplate(template),
    },
    error: null,
  };
}

export interface ImportBlogSettingsTemplateOptions {
  /**
   * Apply the template's `blog` identity block (name / description /
   * niche / keywords / aiPromptTemplate) on top of the destination
   * blog. Defaults to `false` so the destination blog's identity is
   * preserved unless the user explicitly opts in from the UI.
   */
  includeBlogIdentity?: boolean;
  /**
   * Include the template's automation section in the apply payload.
   * Defaults to `true` so cadence + budget settings travel across,
   * but `automation.enabled` is always forced to `false` here so the
   * destination blog never starts spending tokens without an
   * explicit user toggle. Set `false` to leave the destination
   * blog's automation untouched.
   */
  includeAutomation?: boolean;
}

export interface ImportBlogSettingsTemplateInput {
  teamId: string;
  projectId: string;
  blogId: string;
  templateJson: string;
  options?: ImportBlogSettingsTemplateOptions;
}

export interface ImportBlogSettingsTemplateResult {
  warnings: string[];
}

/**
 * Apply a Blog Settings Template JSON to the destination blog.
 *
 * Pipeline:
 *   1. parse + validate via {@link parseBlogSettingsTemplateJson}
 *      (rejects bad kind/version, normalizes settings, clears
 *      pause fields, drops WP credentials);
 *   2. compose an {@link UpdateBlogInput} that only touches:
 *      - identity columns if `includeBlogIdentity` is on,
 *      - the settings jsonb (with `automation` filtered per options
 *        and `enabled` forced to `false`);
 *   3. delegate to {@link updateBlog} so RLS / slug regeneration /
 *      paused-metadata clear / revalidation all share one code
 *      path with the regular settings form save.
 *
 * Never writes to WordPress credential columns or article/job
 * tables — those concerns are entirely out of scope.
 */
export async function importBlogSettingsTemplate(
  input: ImportBlogSettingsTemplateInput,
): Promise<ActionResult<ImportBlogSettingsTemplateResult>> {
  const parsed = parseBlogSettingsTemplateJson(input.templateJson);
  if (!parsed.ok) {
    return { data: null, error: parsed.error.message };
  }

  const { normalizedTemplate, warnings } = parsed;
  const opts = input.options ?? {};
  const includeBlogIdentity = opts.includeBlogIdentity ?? false;
  const includeAutomation = opts.includeAutomation ?? true;

  const payload: UpdateBlogInput = {
    settings: buildSettingsPatch(normalizedTemplate.settings, {
      includeAutomation,
    }),
  };

  if (includeBlogIdentity && normalizedTemplate.blog) {
    const id = normalizedTemplate.blog;
    if (typeof id.name === "string") payload.name = id.name;
    if (typeof id.description === "string") {
      payload.description = id.description;
    }
    if (typeof id.niche === "string") payload.niche = id.niche;
    if (Array.isArray(id.keywords)) payload.keywords = id.keywords;
    if (typeof id.aiPromptTemplate === "string") {
      payload.aiPromptTemplate = id.aiPromptTemplate;
    }
  }

  const importWarnings = [...warnings];
  if (!includeBlogIdentity && normalizedTemplate.blog) {
    importWarnings.push(
      "Blog identity (name/description/niche/keywords/prompt template) was not changed. Enable `Include blog identity` to apply it.",
    );
  }

  const result = await updateBlog(
    input.teamId,
    input.projectId,
    input.blogId,
    payload,
  );

  if (result.error) {
    return { data: null, error: result.error };
  }

  return { data: { warnings: importWarnings }, error: null };
}

/**
 * Strip everything the import path is allowed to apply.
 *
 * Always forces `automation.enabled = false` (and re-asserts the
 * pause-field wipe) regardless of what the parsed template said —
 * the lib already wipes pause fields, but defense-in-depth here
 * means future callers that hand-build a `BlogSettings` and skip
 * `parseBlogSettingsTemplateJson` still get the safe posture.
 *
 * Listing the sections explicitly (rather than spreading + omitting
 * `automation`) makes it obvious which jsonb sections the import
 * path is allowed to touch, and gives TS a chance to catch a
 * forgotten section if a new one is added to `BlogSettings`.
 */
function buildSettingsPatch(
  settings: BlogSettings,
  { includeAutomation }: { includeAutomation: boolean },
): UpdateBlogInput["settings"] {
  const patch: UpdateBlogInput["settings"] = {
    identity: settings.identity,
    strategy: settings.strategy,
    ai: settings.ai,
    seo: settings.seo,
    publishing: settings.publishing,
    media: settings.media,
    advanced: settings.advanced,
  };

  if (includeAutomation) {
    const safeAutomation: BlogAutomationSettings = {
      ...settings.automation,
      enabled: false,
      pausedAt: null,
      pausedReason: null,
      pausedMessage: null,
    };
    patch.automation = safeAutomation;
  }

  return patch;
}
