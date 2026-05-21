/**
 * Versioned JSON template for cloning a blog's settings across blogs,
 * projects, or AI tools.
 *
 * Lives in `lib/` (no `server-only` import) because both server actions
 * (export/import) and client code (the Review-Import preview) need to
 * parse and render the same shape.
 *
 * Safety posture — these rules are enforced by the helpers below, not
 * left as a convention:
 *
 *   * Never serialize WordPress credentials (`wp_url`, `wp_username`,
 *     `wp_app_password`). They live on dedicated columns, not in the
 *     settings jsonb, so omitting them is automatic on the export
 *     path; the import path additionally drops any `wp*` keys a
 *     malicious / AI-edited template might smuggle in.
 *   * Never round-trip the autopilot pause metadata
 *     (`automation.pausedAt / pausedReason / pausedMessage`). These
 *     are system-managed state, not config — exporting them risks
 *     reinstating a stale pause banner on the destination blog.
 *   * Always force `automation.enabled = false` on import unless the
 *     caller explicitly opts in (this PR keeps it false unconditionally
 *     to avoid surprise token spend; the option exists for future
 *     CLI / admin workflows).
 *
 * The shape is intentionally AI-friendly: a single top-level `kind`
 * discriminator, a small integer `schemaVersion`, an optional
 * `exportedAt` ISO timestamp, and the two domains that actually
 * change blog behavior: `blog` (column-level identity) and `settings`
 * (the jsonb).
 */

import {
  type BlogSettings,
  AUTOMATION_MODES,
  ARTICLE_TYPE_OPTIONS,
  CONTENT_GOAL_OPTIONS,
  DEFAULT_BLOG_SETTINGS,
  FEATURED_IMG_PREFS,
  FRESHNESS,
  IMAGE_PROVIDERS,
  IMAGE_SOURCES,
  KEYWORD_USAGE,
  LINK_PREFS,
  loadBlogSettings,
  POVS,
  PREFERRED_DAY_OPTIONS,
  PUB_DESTINATIONS,
  PUB_STATUSES,
  READING_LEVELS,
  SLUG_FORMATS,
} from "@/lib/blog-settings";

export const BLOG_SETTINGS_TEMPLATE_KIND =
  "synthpress.blogSettingsTemplate" as const;
export const BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION = 1 as const;

export type BlogSettingsTemplateKind = typeof BLOG_SETTINGS_TEMPLATE_KIND;
export type BlogSettingsTemplateSchemaVersion =
  typeof BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION;

/**
 * Identity fields that live as columns on `public.blogs` (not in
 * the settings jsonb). All optional so a template can scope itself
 * to "just the settings" if the author wants.
 */
export interface BlogSettingsTemplateBlogIdentity {
  name?: string;
  description?: string;
  niche?: string;
  keywords?: string[];
  aiPromptTemplate?: string;
}

export interface BlogSettingsTemplate {
  kind: BlogSettingsTemplateKind;
  schemaVersion: BlogSettingsTemplateSchemaVersion;
  /** ISO timestamp set at export time. Optional on import. */
  exportedAt?: string;
  /** Optional blog-column identity — omitted from imports unless the user opts in. */
  blog?: BlogSettingsTemplateBlogIdentity;
  settings: BlogSettings;
}

export interface BuildBlogSettingsTemplateInput {
  blog: BlogSettingsTemplateBlogIdentity;
  settings: BlogSettings;
  /** Defaults to `new Date().toISOString()`. Accept an injectable for tests. */
  exportedAt?: string;
}

/**
 * Build a template from a fully-loaded blog row + settings.
 *
 * Sanitization that always happens on the export path:
 *   - settings is re-run through {@link loadBlogSettings} to drop any
 *     unknown keys that might have been written by an older schema.
 *   - `automation.pausedAt / pausedReason / pausedMessage` are forced
 *     to `null` so a paused source blog can't reinstate the banner on
 *     the destination.
 *   - Blank optional fields in `blog` are dropped from the output so
 *     the JSON stays terse for AI prompts.
 *
 * `automation.enabled` is preserved as-is so AI tools can see the
 * source posture; the import path is what guarantees safety by
 * defaulting it to `false`.
 */
export function buildBlogSettingsTemplate(
  input: BuildBlogSettingsTemplateInput,
): BlogSettingsTemplate {
  const normalizedSettings = loadBlogSettings(
    input.settings as unknown as Parameters<typeof loadBlogSettings>[0],
  );

  const safeSettings: BlogSettings = {
    ...normalizedSettings,
    automation: {
      ...normalizedSettings.automation,
      pausedAt: null,
      pausedReason: null,
      pausedMessage: null,
    },
  };

  const blog = pruneBlogIdentity(input.blog);

  const template: BlogSettingsTemplate = {
    kind: BLOG_SETTINGS_TEMPLATE_KIND,
    schemaVersion: BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    settings: safeSettings,
  };
  if (blog) template.blog = blog;
  return template;
}

/**
 * Pretty-print a template for the export modal. Always 2-space
 * indented so the textarea is comfortable to read + AI-paste.
 */
export function serializeBlogSettingsTemplate(
  template: BlogSettingsTemplate,
): string {
  return JSON.stringify(template, null, 2);
}

export type BlogSettingsTemplateErrorCode =
  | "invalid_json"
  | "wrong_kind"
  | "unsupported_schema_version"
  | "missing_settings";

export interface BlogSettingsTemplateError {
  code: BlogSettingsTemplateErrorCode;
  message: string;
}

export type ParseBlogSettingsTemplateResult =
  | {
      ok: true;
      normalizedTemplate: BlogSettingsTemplate;
      warnings: string[];
    }
  | {
      ok: false;
      error: BlogSettingsTemplateError;
    };

/**
 * Parse + validate a JSON string into a normalized
 * {@link BlogSettingsTemplate}.
 *
 * What "normalized" buys callers:
 *   - settings is run through {@link loadBlogSettings} so unknown
 *     keys are dropped, enums clamped, numbers validated.
 *   - `automation.pausedAt / pausedReason / pausedMessage` are forced
 *     to `null` even if the template tried to set them.
 *   - WordPress credential keys (`wp_url`, `wp_username`,
 *     `wp_app_password`, plus the camelCase variants) are stripped
 *     from the `blog` object regardless of where they appear.
 *   - Blank string identity fields are dropped from `blog` so the
 *     downstream "what will change" diff doesn't show "set audience
 *     to empty".
 *
 * Returns a discriminated union so callers can switch on `ok` without
 * try/catch. Each rejection carries a stable `code` for UI strings.
 */
export function parseBlogSettingsTemplateJson(
  jsonText: string,
): ParseBlogSettingsTemplateResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    /* v8 ignore next 1 -- JSON.parse always throws a SyntaxError
       (which is an Error); the non-Error fallback is purely
       defensive and cannot be triggered via the public API. */
    const message = err instanceof Error ? err.message : "Invalid JSON.";
    return {
      ok: false,
      error: {
        code: "invalid_json",
        message: `Could not parse JSON: ${message}`,
      },
    };
  }
  return normalizeImportedBlogSettingsTemplate(raw);
}

/**
 * Same validation as {@link parseBlogSettingsTemplateJson} but
 * accepts a parsed object. Exposed so callers that already have
 * a parsed value (CLI, internal tests, AI tool that produces JS
 * objects) can skip the JSON round-trip.
 */
export function normalizeImportedBlogSettingsTemplate(
  raw: unknown,
): ParseBlogSettingsTemplateResult {
  if (!isObject(raw)) {
    return {
      ok: false,
      error: {
        code: "invalid_json",
        message: "Template must be a JSON object.",
      },
    };
  }

  if (raw.kind !== BLOG_SETTINGS_TEMPLATE_KIND) {
    return {
      ok: false,
      error: {
        code: "wrong_kind",
        message: `Unrecognized template kind. Expected "${BLOG_SETTINGS_TEMPLATE_KIND}".`,
      },
    };
  }

  if (raw.schemaVersion !== BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        code: "unsupported_schema_version",
        message: `Unsupported schemaVersion ${String(raw.schemaVersion)}. This version of SynthPress supports schemaVersion ${BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION}.`,
      },
    };
  }

  if (!isObject(raw.settings)) {
    return {
      ok: false,
      error: {
        code: "missing_settings",
        message: "Template is missing a `settings` object.",
      },
    };
  }

  const warnings: string[] = [];

  const rawBlog = isObject(raw.blog) ? raw.blog : null;
  const credentialKeysDetected = detectCredentialKeys(raw, rawBlog);
  if (credentialKeysDetected) {
    warnings.push(
      "WordPress credentials were ignored. Import never sets wp_url, wp_username, or wp_app_password.",
    );
  }

  const settings = loadBlogSettings(
    raw.settings as Parameters<typeof loadBlogSettings>[0],
  );

  // System-managed pause state never crosses an import boundary. Even
  // if the source template (or an AI edit) supplied values, we wipe
  // them so the destination blog never inherits a stale pause banner.
  const safeSettings: BlogSettings = {
    ...settings,
    automation: {
      ...settings.automation,
      pausedAt: null,
      pausedReason: null,
      pausedMessage: null,
    },
  };

  const blog = rawBlog ? extractBlogIdentity(rawBlog) : undefined;
  if (rawBlog && !blog) {
    // Blog object existed but had nothing usable after sanitization —
    // mention it so the user isn't surprised when "Apply" doesn't
    // touch blog-level fields.
    warnings.push(
      "Template's `blog` block had no recognized identity fields and was ignored.",
    );
  }

  const exportedAt =
    typeof raw.exportedAt === "string" ? raw.exportedAt : undefined;

  const unknownKeys = listUnknownTopLevelKeys(raw);
  if (unknownKeys.length > 0) {
    warnings.push(
      `Ignored unknown top-level fields: ${unknownKeys.join(", ")}.`,
    );
  }

  const normalizedTemplate: BlogSettingsTemplate = {
    kind: BLOG_SETTINGS_TEMPLATE_KIND,
    schemaVersion: BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
    settings: safeSettings,
  };
  if (exportedAt) normalizedTemplate.exportedAt = exportedAt;
  if (blog) normalizedTemplate.blog = blog;

  return { ok: true, normalizedTemplate, warnings };
}

export interface BlogSettingsTemplateChangesPreview {
  /** jsonb sections whose values differ from the destination blog's current settings. */
  settingsSectionsChanged: (keyof BlogSettings)[];
  /** Blog column-level identity fields that would change if `includeBlogIdentity` were on. */
  blogIdentityFieldsChanged: (keyof BlogSettingsTemplateBlogIdentity)[];
  /** True iff the template carries a `blog` identity block. */
  includesBlogIdentity: boolean;
  /** True iff the template includes automation cadence settings (always true today; reserved for future scoped templates). */
  includesAutomation: boolean;
}

/**
 * Build a quick "what will change" summary for the import preview.
 *
 * Intentionally coarse — we only diff at the section level for
 * jsonb (8 sections) and the column level for blog identity. A full
 * deep diff is more UI than this MVP needs; the user is reviewing
 * a JSON they (or an AI) just edited, so the goal is "what areas
 * does this touch", not "line-by-line audit".
 */
export function buildBlogSettingsTemplateChangesPreview(
  normalizedTemplate: BlogSettingsTemplate,
  current: { blog: BlogSettingsTemplateBlogIdentity; settings: BlogSettings },
): BlogSettingsTemplateChangesPreview {
  const sections: (keyof BlogSettings)[] = [
    "identity",
    "strategy",
    "ai",
    "seo",
    "automation",
    "publishing",
    "media",
    "advanced",
  ];
  const settingsSectionsChanged = sections.filter(
    (s) =>
      JSON.stringify(normalizedTemplate.settings[s]) !==
      JSON.stringify(current.settings[s]),
  );

  const blogIdentityFieldsChanged: (keyof BlogSettingsTemplateBlogIdentity)[] =
    [];
  if (normalizedTemplate.blog) {
    const tmpl = normalizedTemplate.blog;
    if (tmpl.name !== undefined && tmpl.name !== current.blog.name) {
      blogIdentityFieldsChanged.push("name");
    }
    if (
      tmpl.description !== undefined &&
      tmpl.description !== current.blog.description
    ) {
      blogIdentityFieldsChanged.push("description");
    }
    if (tmpl.niche !== undefined && tmpl.niche !== current.blog.niche) {
      blogIdentityFieldsChanged.push("niche");
    }
    if (
      tmpl.keywords !== undefined &&
      JSON.stringify(tmpl.keywords) !== JSON.stringify(current.blog.keywords)
    ) {
      blogIdentityFieldsChanged.push("keywords");
    }
    if (
      tmpl.aiPromptTemplate !== undefined &&
      tmpl.aiPromptTemplate !== current.blog.aiPromptTemplate
    ) {
      blogIdentityFieldsChanged.push("aiPromptTemplate");
    }
  }

  return {
    settingsSectionsChanged,
    blogIdentityFieldsChanged,
    includesBlogIdentity: Boolean(normalizedTemplate.blog),
    includesAutomation: true,
  };
}

/**
 * Suggested AI prompt rendered next to the export modal. Returned
 * from a helper (not inlined in the React tree) so tests can assert
 * the copy and Storybook can render it without coupling.
 *
 * Kept for back-compat with callers that only want a one-line prompt.
 * The richer {@link buildBlogSettingsTemplateAiGuide} is what the
 * Export modal's "Copy AI prompt + JSON" button uses today.
 */
export function buildBlogSettingsTemplateAiPrompt(topic = "[topic]"): string {
  return `Edit this SynthPress blog settings JSON for a blog about ${topic}. Keep the same schemaVersion and kind. Return valid JSON only.`;
}

export interface BuildBlogSettingsTemplateAiGuideInput {
  /** The pretty-printed template JSON to embed at the bottom of the guide. */
  templateJson: string;
  /**
   * Optional topic / niche substituted into the Task line. Defaults
   * to `[topic]` so the prompt is still usable without one.
   */
  topic?: string;
}

/**
 * Long-form AI editing guide for a Blog Settings Template export.
 *
 * Designed to be pasted into ChatGPT / Claude alongside the JSON so
 * the model knows:
 *   * what the discriminator fields mean and how to preserve them,
 *   * which fields are safety-sensitive (credentials, autopilot),
 *   * which enum values are allowed (regenerated from the live
 *     constants in `blog-settings.ts`, so AI never gets a stale
 *     value the runtime normalizer would silently drop),
 *   * which media / publishing fields are MVP-active vs legacy/future
 *     (so AI doesn't over-tune knobs that don't drive runtime
 *     behavior today).
 *
 * The output is plain markdown — no ANSI, no smart quotes, no
 * trailing whitespace — so it round-trips cleanly through every
 * clipboard / AI chat interface we've tested.
 *
 * The JSON is embedded inside a fenced code block at the very end
 * so a model that streams its reply can still echo the JSON
 * verbatim and our import-side parser will accept it (the
 * "Return JSON only" rule earlier in the guide tells the model to
 * strip the fence, but if it doesn't, the user can still trivially
 * peel the fence by hand).
 */
export function buildBlogSettingsTemplateAiGuide(
  input: BuildBlogSettingsTemplateAiGuideInput,
): string {
  const topic = input.topic?.trim() || "[topic]";
  const instructions = buildBlogSettingsTemplateAiGuideText({ topic });
  return `${instructions}\n\n## Template JSON\n\nEdit the JSON below and return only JSON.\n\n\`\`\`json\n${input.templateJson}\n\`\`\`\n`;
}

/**
 * Same instructional markdown as {@link buildBlogSettingsTemplateAiGuide}
 * but WITHOUT the JSON appendix. Used by the export modal so the
 * "guide" can be rendered in a textarea while the JSON keeps its
 * own textarea — and so tests can assert the guide copy without
 * having to mock a serialized template.
 */
export function buildBlogSettingsTemplateAiGuideText(
  opts: { topic?: string } = {},
): string {
  const topic = opts.topic?.trim() || "[topic]";

  // ─── Enum reference rows are derived from the runtime constants
  // exported by `blog-settings.ts`. Adding a new value to a tuple
  // there automatically appears in the AI guide — there is no
  // separate "AI-known enums" list to keep in sync.
  const lines = [
    "# SynthPress blog settings template — AI editing guide",
    "",
    "## Task",
    `Edit the JSON at the end of this guide for a blog about ${topic}. Return valid JSON only — no markdown fences, no explanatory text.`,
    "",
    "## Safety rules",
    `- Keep \`kind\` exactly \`"${BLOG_SETTINGS_TEMPLATE_KIND}"\`.`,
    `- Keep \`schemaVersion\` as \`${BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION}\` (only version supported today).`,
    "- Do NOT add WordPress credentials (`wp_url`, `wp_username`, `wp_app_password`, or any camelCase variants). They are stripped on import either way.",
    "- Do NOT add team IDs, project IDs, blog IDs, API keys, or other secrets.",
    "- Do NOT set `settings.automation.enabled` to `true` — import always forces it to `false` so autopilot is never armed without an explicit user toggle.",
    "- Leave `settings.automation.pausedAt`, `settings.automation.pausedReason`, `settings.automation.pausedMessage` as `null`. They are system-managed pause state.",
    "- Use only the allowed enum values listed in the Enum reference below. Unknown values fall back to defaults silently.",
    "- Return JSON only.",
    "",
    "## Top-level fields",
    `- \`kind\` — required discriminator. Keep exact value \`${BLOG_SETTINGS_TEMPLATE_KIND}\`.`,
    `- \`schemaVersion\` — required integer. Keep as \`${BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION}\`.`,
    "- `exportedAt` — optional ISO timestamp. Safe to leave, remove, or update.",
    "- `blog` — optional identity overlay (`name`, `description`, `niche`, `keywords[]`, `aiPromptTemplate`). Edit freely; the import UI lets the user opt in to applying it.",
    "- `settings` — required jsonb of all editorial / automation / publishing settings (see below).",
    "",
    "## Settings sections (`settings.*`)",
    "- `identity` — voice, audience, language, reading level, point of view.",
    "- `strategy` — topics, goals, article types, content freshness, monetization, competitors.",
    "- `ai` — generation preferences (positive/negative prompt, terminology, example article style, CTA).",
    "- `seo` — article SEO guidance (keyword usage, linking, slug format, FAQ / schema markup, featured image preference).",
    "- `automation` — cadence / backlog / token budget / publish windows. Import always keeps `automation.enabled = false`.",
    "- `publishing` — WordPress draft defaults (destination, default status, category/tags/author, featured-image upload, autopilot auto-send to WP draft).",
    "- `media` — Pexels stock image behavior (auto-pick toggle, provider, inline images).",
    "- `advanced` — disclaimers, affiliate disclosure, internal-link priorities, competitor avoidance, custom system / article / outline prompt templates.",
    "",
    "## MVP-active vs legacy / future fields",
    "These fields are persisted for backward compatibility but not surfaced in the MVP UI. Edit only when intentional:",
    "",
    "- Active media fields: `media.autoPickImages`, `media.imageProvider`, `media.includeInlineImages`.",
    "- Legacy / future media fields: `media.imageSource`, `media.generateFeaturedImage`, `media.imageStylePrompt`, `media.defaultImageDimensions`, `media.generateAltText`.",
    "- Autopilot currently sends WordPress drafts only — never live publish. `publishing.autoSendToWordPressDraft` is the live gate; `publishing.defaultStatus`, `publishing.updateExistingPosts`, and `publishing.defaultDestination` are kept for forward-compat.",
    "- Active image provider: `pexels`. `none` disables auto-picking. Legacy stored values like `unsplash` silently roll forward to `pexels` on load.",
    "",
    "## Enum reference",
    "(Generated from the live runtime constants — values not listed here are silently dropped by the import-side normalizer.)",
    "",
    "### identity.language",
    "Free-form BCP-47 language code. Default `en`.",
    "",
    "### identity.readingLevel",
    ...bulletList(READING_LEVELS),
    "",
    "### identity.pointOfView",
    ...bulletList(POVS),
    "",
    "### strategy.goals (array)",
    ...bulletList(CONTENT_GOAL_OPTIONS.map((o) => o.value)),
    "",
    "### strategy.preferredArticleTypes (array of slugs)",
    ...bulletList(ARTICLE_TYPE_OPTIONS.map((o) => o.value)),
    "",
    "### strategy.contentFreshness",
    ...bulletList(FRESHNESS),
    "",
    "### seo.keywordUsage",
    ...bulletList(KEYWORD_USAGE),
    "",
    "### seo.internalLinkingPreference / seo.externalLinkingPreference",
    ...bulletList(LINK_PREFS),
    "",
    "### seo.slugFormat",
    ...bulletList(SLUG_FORMATS),
    "",
    "### seo.featuredImagePreference",
    ...bulletList(FEATURED_IMG_PREFS),
    "",
    "### automation.mode",
    ...bulletList(AUTOMATION_MODES),
    "",
    "### automation.preferredDays (array)",
    ...bulletList(PREFERRED_DAY_OPTIONS),
    "",
    "### publishing.defaultDestination",
    ...bulletList(PUB_DESTINATIONS),
    "",
    "### publishing.defaultStatus",
    ...bulletList(PUB_STATUSES),
    "(autopilot only sends `draft` today)",
    "",
    "### media.imageProvider (active)",
    ...bulletList(IMAGE_PROVIDERS),
    "",
    "### media.imageSource (legacy / future)",
    ...bulletList(IMAGE_SOURCES),
  ];

  return lines.join("\n");
}

function bulletList(values: readonly string[]): string[] {
  return values.map((v) => `- \`${v}\``);
}

// ─── JSON schema export ─────────────────────────────────────────────────────

export interface BlogSettingsTemplateJsonSchema {
  $schema: string;
  title: string;
  description: string;
  type: "object";
  required: ["kind", "schemaVersion", "settings"];
  properties: Record<string, unknown>;
  additionalProperties: boolean;
}

/**
 * Build a JSON-schema-like description of the template shape.
 *
 * Optional — not required for import; the runtime normalizer is the
 * actual source of truth and is more permissive (drops unknowns,
 * clamps enums) than a strict schema validation would be.
 *
 * Use cases:
 *   * "Copy schema reference" affordance in the export modal for
 *     users who want their AI tool to validate against a schema
 *     before returning.
 *   * Future docs page / public API surface.
 *
 * The schema is deliberately permissive: every string field uses
 * `type: "string"`, every closed enum uses `enum: [...]` to enable
 * AI suggestions, and the top-level `additionalProperties` is
 * `false` so AI tools that respect it won't add stray keys.
 */
export function buildBlogSettingsTemplateJsonSchema(): BlogSettingsTemplateJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "SynthPress Blog Settings Template",
    description:
      "Versioned JSON template for cloning a blog's settings across blogs, projects, or AI tools.",
    type: "object",
    required: ["kind", "schemaVersion", "settings"],
    additionalProperties: false,
    properties: {
      kind: {
        type: "string",
        const: BLOG_SETTINGS_TEMPLATE_KIND,
        description: "Discriminator. Must be exactly this value.",
      },
      schemaVersion: {
        type: "integer",
        const: BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
        description: `Integer schema version. Current = ${BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION}.`,
      },
      exportedAt: {
        type: "string",
        description: "Optional ISO 8601 timestamp set at export time.",
      },
      blog: {
        type: "object",
        description:
          "Optional blog-column identity overlay. The import UI lets the user opt in to applying it.",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          niche: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          aiPromptTemplate: { type: "string" },
        },
      },
      settings: {
        type: "object",
        description: "Full settings jsonb. Unknown keys are ignored on import.",
        additionalProperties: false,
        required: [
          "identity",
          "strategy",
          "ai",
          "seo",
          "automation",
          "publishing",
          "media",
          "advanced",
        ],
        properties: {
          identity: {
            type: "object",
            properties: {
              audience: { type: "string" },
              language: {
                type: "string",
                description: "BCP-47 language code. Default `en`.",
              },
              tone: { type: "string" },
              readingLevel: { type: "string", enum: [...READING_LEVELS] },
              pointOfView: { type: "string", enum: [...POVS] },
              defaultAuthorPersona: { type: "string" },
            },
          },
          strategy: {
            type: "object",
            properties: {
              goals: {
                type: "array",
                items: {
                  type: "string",
                  enum: CONTENT_GOAL_OPTIONS.map((o) => o.value),
                },
              },
              monetization: { type: "string" },
              competitors: { type: "string" },
              contentFreshness: { type: "string", enum: [...FRESHNESS] },
              preferredArticleTypes: {
                type: "array",
                items: {
                  type: "string",
                  enum: ARTICLE_TYPE_OPTIONS.map((o) => o.value),
                },
              },
              topicsToCover: { type: "string" },
              topicsToAvoid: { type: "string" },
            },
          },
          ai: {
            type: "object",
            properties: {
              positivePrompt: { type: "string" },
              negativePrompt: { type: "string" },
              approvedTerminology: { type: "string" },
              bannedTerminology: { type: "string" },
              exampleArticleStyle: { type: "string" },
              defaultArticleStructure: { type: "string" },
              preferredCta: { type: "string" },
            },
          },
          seo: {
            type: "object",
            properties: {
              strategy: { type: "string" },
              metaDescriptionStyle: { type: "string" },
              keywordUsage: { type: "string", enum: [...KEYWORD_USAGE] },
              internalLinkingPreference: {
                type: "string",
                enum: [...LINK_PREFS],
              },
              externalLinkingPreference: {
                type: "string",
                enum: [...LINK_PREFS],
              },
              slugFormat: { type: "string", enum: [...SLUG_FORMATS] },
              titleFormat: { type: "string" },
              defaultArticleLength: { type: "integer", minimum: 0 },
              defaultHeadingsStructure: { type: "string" },
              faqSection: { type: "boolean" },
              schemaMarkup: { type: "boolean" },
              featuredImagePreference: {
                type: "string",
                enum: [...FEATURED_IMG_PREFS],
              },
            },
          },
          automation: {
            type: "object",
            properties: {
              mode: { type: "string", enum: [...AUTOMATION_MODES] },
              enabled: {
                type: "boolean",
                description:
                  "ALWAYS forced to `false` on import. Set to `false` in the template too for clarity.",
              },
              generatePerWeek: { type: "integer", minimum: 0 },
              requireReview: { type: "boolean" },
              autoSchedule: { type: "boolean" },
              preferredDays: {
                type: "array",
                items: { type: "string", enum: [...PREFERRED_DAY_OPTIONS] },
              },
              publishWindowStart: {
                type: "string",
                description: "HH:MM (24h).",
              },
              publishWindowEnd: { type: "string", description: "HH:MM (24h)." },
              timezone: {
                type: "string",
                description: "IANA timezone (e.g. `Etc/UTC`).",
              },
              maxPostsPerDay: { type: "integer", minimum: 0 },
              regenerateOnFail: { type: "boolean" },
              backlogThreshold: { type: "integer", minimum: 0 },
              dailyTokenBudget: {
                type: ["integer", "null"],
                description: "`null` means no per-blog cap.",
              },
              pausedReason: {
                type: ["string", "null"],
                description: "System-managed. Always wiped on import.",
              },
              pausedAt: {
                type: ["string", "null"],
                description: "System-managed. Always wiped on import.",
              },
              pausedMessage: {
                type: ["string", "null"],
                description: "System-managed. Always wiped on import.",
              },
            },
          },
          publishing: {
            type: "object",
            properties: {
              defaultDestination: {
                type: "string",
                enum: [...PUB_DESTINATIONS],
              },
              defaultStatus: { type: "string", enum: [...PUB_STATUSES] },
              defaultCategory: { type: "string" },
              defaultTags: { type: "array", items: { type: "string" } },
              defaultAuthor: { type: "string" },
              uploadFeaturedImage: { type: "boolean" },
              updateExistingPosts: {
                type: "boolean",
                description: "Legacy / forward-compat.",
              },
              autoSendToWordPressDraft: {
                type: "boolean",
                description:
                  "MVP-active. Gates whether autopilot pushes to WP draft after generation.",
              },
            },
          },
          media: {
            type: "object",
            properties: {
              autoPickImages: {
                type: "boolean",
                description: "MVP-active.",
              },
              imageProvider: {
                type: "string",
                enum: [...IMAGE_PROVIDERS],
                description: "MVP-active.",
              },
              includeInlineImages: {
                type: "boolean",
                description: "MVP-active.",
              },
              imageSource: {
                type: "string",
                enum: [...IMAGE_SOURCES],
                description: "Legacy / future.",
              },
              generateFeaturedImage: {
                type: "boolean",
                description: "Legacy / future.",
              },
              imageStylePrompt: {
                type: "string",
                description: "Legacy / future.",
              },
              defaultImageDimensions: {
                type: "string",
                description: "Legacy / future.",
              },
              generateAltText: {
                type: "boolean",
                description: "Legacy / future.",
              },
            },
          },
          advanced: {
            type: "object",
            properties: {
              customSystemPrompt: { type: "string" },
              customArticleTemplate: { type: "string" },
              customOutlineTemplate: { type: "string" },
              defaultDisclaimer: { type: "string" },
              affiliateDisclosure: { type: "string" },
              internalLinksToPrioritize: { type: "string" },
              competitorsToAvoid: { type: "string" },
            },
          },
        },
      },
    },
  };
}

// ─── internals ───────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const KNOWN_TEMPLATE_KEYS = new Set([
  "kind",
  "schemaVersion",
  "exportedAt",
  "blog",
  "settings",
]);

const CREDENTIAL_KEYS = [
  "wp_url",
  "wp_username",
  "wp_app_password",
  "wpUrl",
  "wpUsername",
  "wpAppPassword",
] as const;

function listUnknownTopLevelKeys(raw: Record<string, unknown>): string[] {
  return Object.keys(raw).filter((k) => !KNOWN_TEMPLATE_KEYS.has(k));
}

function detectCredentialKeys(
  raw: Record<string, unknown>,
  blog: Record<string, unknown> | null,
): boolean {
  for (const key of CREDENTIAL_KEYS) {
    if (key in raw) return true;
    if (blog && key in blog) return true;
  }
  return false;
}

/**
 * Pull out only the recognized identity fields, drop blanks, and
 * coerce types defensively. Returns `undefined` if nothing survived
 * (lets {@link buildBlogSettingsTemplate} omit the `blog` block).
 */
function extractBlogIdentity(
  raw: Record<string, unknown>,
): BlogSettingsTemplateBlogIdentity | undefined {
  const out: BlogSettingsTemplateBlogIdentity = {};

  if (typeof raw.name === "string" && raw.name.trim()) {
    out.name = raw.name;
  }
  if (typeof raw.description === "string") {
    out.description = raw.description;
  }
  if (typeof raw.niche === "string") {
    out.niche = raw.niche;
  }
  if (Array.isArray(raw.keywords)) {
    const kws = raw.keywords.filter(
      (k): k is string => typeof k === "string" && k.trim().length > 0,
    );
    out.keywords = kws;
  }
  if (typeof raw.aiPromptTemplate === "string") {
    out.aiPromptTemplate = raw.aiPromptTemplate;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Build-side equivalent of {@link extractBlogIdentity}: trims and
 * drops empty values so the exported JSON is terse.
 */
function pruneBlogIdentity(
  identity: BlogSettingsTemplateBlogIdentity,
): BlogSettingsTemplateBlogIdentity | undefined {
  const out: BlogSettingsTemplateBlogIdentity = {};
  if (identity.name && identity.name.trim()) out.name = identity.name;
  if (identity.description !== undefined && identity.description !== "") {
    out.description = identity.description;
  }
  if (identity.niche !== undefined && identity.niche !== "") {
    out.niche = identity.niche;
  }
  if (identity.keywords && identity.keywords.length > 0) {
    out.keywords = identity.keywords;
  }
  if (
    identity.aiPromptTemplate !== undefined &&
    identity.aiPromptTemplate !== ""
  ) {
    out.aiPromptTemplate = identity.aiPromptTemplate;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Re-export so callers can build a "defaults preview" or pass the
// settings type around without importing two modules.
export { DEFAULT_BLOG_SETTINGS };
export type { BlogSettings };
