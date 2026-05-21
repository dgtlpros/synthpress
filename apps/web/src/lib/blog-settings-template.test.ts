import { describe, expect, it } from "vitest";
import { DEFAULT_BLOG_SETTINGS } from "./blog-settings";
import {
  BLOG_SETTINGS_TEMPLATE_KIND,
  BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
  buildBlogSettingsTemplate,
  buildBlogSettingsTemplateAiGuide,
  buildBlogSettingsTemplateAiGuideText,
  buildBlogSettingsTemplateAiPrompt,
  buildBlogSettingsTemplateChangesPreview,
  buildBlogSettingsTemplateJsonSchema,
  normalizeImportedBlogSettingsTemplate,
  parseBlogSettingsTemplateJson,
  serializeBlogSettingsTemplate,
} from "./blog-settings-template";

const FIXED_TS = "2026-05-20T18:30:00.000Z";

describe("buildBlogSettingsTemplate", () => {
  it("returns the canonical kind + schemaVersion + exportedAt", () => {
    const template = buildBlogSettingsTemplate({
      blog: { name: "Indie" },
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: FIXED_TS,
    });
    expect(template.kind).toBe(BLOG_SETTINGS_TEMPLATE_KIND);
    expect(template.schemaVersion).toBe(BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION);
    expect(template.exportedAt).toBe(FIXED_TS);
  });

  it("includes the safe blog identity fields when present", () => {
    const template = buildBlogSettingsTemplate({
      blog: {
        name: "Indie",
        description: "Stories about building bootstrapped products.",
        niche: "indie hackers",
        keywords: ["ai", "saas"],
        aiPromptTemplate: "Use the company voice.",
      },
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: FIXED_TS,
    });
    expect(template.blog).toEqual({
      name: "Indie",
      description: "Stories about building bootstrapped products.",
      niche: "indie hackers",
      keywords: ["ai", "saas"],
      aiPromptTemplate: "Use the company voice.",
    });
  });

  it("drops blank/empty optional blog fields so the JSON stays terse", () => {
    const template = buildBlogSettingsTemplate({
      blog: {
        name: "Indie",
        description: "",
        niche: "",
        keywords: [],
        aiPromptTemplate: "",
      },
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: FIXED_TS,
    });
    expect(template.blog).toEqual({ name: "Indie" });
  });

  it("omits the `blog` block entirely when nothing meaningful is present", () => {
    const template = buildBlogSettingsTemplate({
      blog: { name: "", description: "" },
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: FIXED_TS,
    });
    expect(template.blog).toBeUndefined();
  });

  it("always includes the full settings object", () => {
    const template = buildBlogSettingsTemplate({
      blog: {},
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: FIXED_TS,
    });
    expect(template.settings).toEqual(DEFAULT_BLOG_SETTINGS);
  });

  it("clears autopilot pause metadata even if the source blog has it set", () => {
    const template = buildBlogSettingsTemplate({
      blog: {},
      settings: {
        ...DEFAULT_BLOG_SETTINGS,
        automation: {
          ...DEFAULT_BLOG_SETTINGS.automation,
          pausedAt: "2026-05-01T00:00:00.000Z",
          pausedReason: "failure_rate",
          pausedMessage: "Auto-paused due to repeated failures.",
        },
      },
      exportedAt: FIXED_TS,
    });
    expect(template.settings.automation.pausedAt).toBeNull();
    expect(template.settings.automation.pausedReason).toBeNull();
    expect(template.settings.automation.pausedMessage).toBeNull();
  });

  it("normalizes the settings (drops unknown keys, clamps enums)", () => {
    const template = buildBlogSettingsTemplate({
      blog: {},
      settings: {
        ...DEFAULT_BLOG_SETTINGS,
        // Cast through unknown — we want to exercise the runtime
        // normalizer with junk that TS would normally forbid.
        seo: {
          ...DEFAULT_BLOG_SETTINGS.seo,
          keywordUsage: "hyperaggressive",
        },
      } as unknown as Parameters<
        typeof buildBlogSettingsTemplate
      >[0]["settings"],
      exportedAt: FIXED_TS,
    });
    expect(template.settings.seo.keywordUsage).toBe("balanced");
  });

  it("never includes WordPress credential keys, even at the top level", () => {
    const template = buildBlogSettingsTemplate({
      blog: { name: "Indie" },
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: FIXED_TS,
    });
    const json = serializeBlogSettingsTemplate(template);
    expect(json).not.toMatch(/wp_url/);
    expect(json).not.toMatch(/wp_username/);
    expect(json).not.toMatch(/wp_app_password/);
    expect(json).not.toMatch(/wpAppPassword/);
  });

  it("fills exportedAt automatically when not provided", () => {
    const template = buildBlogSettingsTemplate({
      blog: {},
      settings: DEFAULT_BLOG_SETTINGS,
    });
    expect(typeof template.exportedAt).toBe("string");
    expect(template.exportedAt!.length).toBeGreaterThan(0);
  });
});

describe("serializeBlogSettingsTemplate", () => {
  it("pretty-prints with 2-space indentation", () => {
    const template = buildBlogSettingsTemplate({
      blog: { name: "Indie" },
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: FIXED_TS,
    });
    const json = serializeBlogSettingsTemplate(template);
    expect(json).toContain('\n  "kind"');
    expect(json).toContain('\n  "schemaVersion"');
    expect(json).toContain('\n  "settings"');
    expect(JSON.parse(json)).toEqual(template);
  });
});

describe("parseBlogSettingsTemplateJson", () => {
  function freshTemplateJson(
    overrides: Partial<Record<string, unknown>> = {},
  ): string {
    return JSON.stringify({
      kind: BLOG_SETTINGS_TEMPLATE_KIND,
      schemaVersion: BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
      settings: DEFAULT_BLOG_SETTINGS,
      ...overrides,
    });
  }

  it("rejects invalid JSON with code `invalid_json`", () => {
    const result = parseBlogSettingsTemplateJson("{ not json");
    if (result.ok) throw new Error("expected !ok");
    expect(result.error.code).toBe("invalid_json");
  });

  it("rejects non-object JSON (e.g. an array)", () => {
    const result = parseBlogSettingsTemplateJson("[1, 2, 3]");
    if (result.ok) throw new Error("expected !ok");
    expect(result.error.code).toBe("invalid_json");
  });

  it("rejects wrong `kind` with code `wrong_kind`", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({ kind: "something.else" }),
    );
    if (result.ok) throw new Error("expected !ok");
    expect(result.error.code).toBe("wrong_kind");
  });

  it("rejects unsupported `schemaVersion`", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({ schemaVersion: 999 }),
    );
    if (result.ok) throw new Error("expected !ok");
    expect(result.error.code).toBe("unsupported_schema_version");
  });

  it("rejects a missing settings object", () => {
    const result = parseBlogSettingsTemplateJson(
      JSON.stringify({
        kind: BLOG_SETTINGS_TEMPLATE_KIND,
        schemaVersion: BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
      }),
    );
    if (result.ok) throw new Error("expected !ok");
    expect(result.error.code).toBe("missing_settings");
  });

  it("normalizes malformed settings (clamps + drops unknowns)", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({
        settings: {
          ...DEFAULT_BLOG_SETTINGS,
          seo: { keywordUsage: "hyperaggressive" },
          totallyMadeUpSection: { foo: "bar" },
        },
      }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.normalizedTemplate.settings.seo.keywordUsage).toBe(
      "balanced",
    );
    expect(
      (result.normalizedTemplate.settings as unknown as Record<string, unknown>)
        .totallyMadeUpSection,
    ).toBeUndefined();
  });

  it("warns about and ignores unknown top-level fields", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({ extraKey: "x", anotherKey: "y" }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.warnings.join("\n")).toMatch(
      /Ignored unknown top-level fields: .*extraKey.*anotherKey/,
    );
    expect(result.normalizedTemplate).not.toHaveProperty("extraKey");
    expect(result.normalizedTemplate).not.toHaveProperty("anotherKey");
  });

  it("ignores WordPress credentials at the top level + warns", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({
        wp_url: "https://wp.example.com",
        wp_username: "admin",
        wp_app_password: "secret",
      }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.warnings.join("\n")).toMatch(/credentials were ignored/i);
    const json = JSON.stringify(result.normalizedTemplate);
    expect(json).not.toMatch(/wp_url/);
    expect(json).not.toMatch(/wp_app_password/);
  });

  it("ignores WordPress credentials inside the blog block + warns", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({
        blog: {
          name: "Indie",
          wp_app_password: "secret",
          wpAppPassword: "secret-camel",
        },
      }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.warnings.join("\n")).toMatch(/credentials were ignored/i);
    expect(result.normalizedTemplate.blog).toEqual({ name: "Indie" });
  });

  it("clears autopilot pause fields even if the template tries to set them", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({
        settings: {
          ...DEFAULT_BLOG_SETTINGS,
          automation: {
            ...DEFAULT_BLOG_SETTINGS.automation,
            pausedAt: "2026-05-01T00:00:00.000Z",
            pausedReason: "failure_rate",
            pausedMessage: "Should be wiped.",
          },
        },
      }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.normalizedTemplate.settings.automation.pausedAt).toBeNull();
    expect(
      result.normalizedTemplate.settings.automation.pausedReason,
    ).toBeNull();
    expect(
      result.normalizedTemplate.settings.automation.pausedMessage,
    ).toBeNull();
  });

  it("preserves automation.enabled in the parsed template (import action is what defaults it to false)", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({
        settings: {
          ...DEFAULT_BLOG_SETTINGS,
          automation: {
            ...DEFAULT_BLOG_SETTINGS.automation,
            enabled: true,
            mode: "autopilot",
          },
        },
      }),
    );
    if (!result.ok) throw new Error("expected ok");
    // The lib doesn't force enabled=false; that's the import action's
    // job. The lib is also used for "what would this template look
    // like" previews where preserving the source posture matters.
    expect(result.normalizedTemplate.settings.automation.enabled).toBe(true);
    expect(result.normalizedTemplate.settings.automation.mode).toBe(
      "autopilot",
    );
  });

  it("warns when the blog block exists but has nothing usable", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({
        blog: { wp_url: "https://example.com" },
      }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.normalizedTemplate.blog).toBeUndefined();
    expect(result.warnings.join("\n")).toMatch(/no recognized identity/i);
  });

  it("preserves exportedAt when it is a string", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({ exportedAt: FIXED_TS }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.normalizedTemplate.exportedAt).toBe(FIXED_TS);
  });

  it("drops a malformed exportedAt (number) silently", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({ exportedAt: 12345 }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.normalizedTemplate.exportedAt).toBeUndefined();
  });
});

describe("normalizeImportedBlogSettingsTemplate", () => {
  it("rejects non-object input", () => {
    const result = normalizeImportedBlogSettingsTemplate(null);
    if (result.ok) throw new Error("expected !ok");
    expect(result.error.code).toBe("invalid_json");
  });

  it("happy-path round-trips through build + normalize", () => {
    const built = buildBlogSettingsTemplate({
      blog: { name: "Indie", niche: "saas" },
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: FIXED_TS,
    });
    const result = normalizeImportedBlogSettingsTemplate(built);
    if (!result.ok) throw new Error("expected ok");
    expect(result.normalizedTemplate.kind).toBe(BLOG_SETTINGS_TEMPLATE_KIND);
    expect(result.normalizedTemplate.blog).toEqual({
      name: "Indie",
      niche: "saas",
    });
    expect(result.warnings).toEqual([]);
  });
});

describe("buildBlogSettingsTemplateChangesPreview", () => {
  it("reports no settings sections changed when template equals current", () => {
    const template = buildBlogSettingsTemplate({
      blog: {},
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: FIXED_TS,
    });
    const preview = buildBlogSettingsTemplateChangesPreview(template, {
      blog: { name: "Indie" },
      settings: DEFAULT_BLOG_SETTINGS,
    });
    expect(preview.settingsSectionsChanged).toEqual([]);
    expect(preview.blogIdentityFieldsChanged).toEqual([]);
    expect(preview.includesBlogIdentity).toBe(false);
    expect(preview.includesAutomation).toBe(true);
  });

  it("reports the sections that changed", () => {
    const template = buildBlogSettingsTemplate({
      blog: {},
      settings: {
        ...DEFAULT_BLOG_SETTINGS,
        identity: { ...DEFAULT_BLOG_SETTINGS.identity, audience: "Founders" },
        seo: { ...DEFAULT_BLOG_SETTINGS.seo, defaultArticleLength: 2400 },
      },
      exportedAt: FIXED_TS,
    });
    const preview = buildBlogSettingsTemplateChangesPreview(template, {
      blog: { name: "Indie" },
      settings: DEFAULT_BLOG_SETTINGS,
    });
    expect(preview.settingsSectionsChanged).toEqual(["identity", "seo"]);
  });

  it("reports the blog identity fields that differ", () => {
    const template = buildBlogSettingsTemplate({
      blog: {
        name: "New name",
        description: "New description",
        niche: "indie hackers",
        keywords: ["ai", "ml"],
        aiPromptTemplate: "{{NEW}}",
      },
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: FIXED_TS,
    });
    const preview = buildBlogSettingsTemplateChangesPreview(template, {
      blog: {
        name: "Old name",
        description: "Old description",
        niche: "indie hackers",
        keywords: ["ai"],
        aiPromptTemplate: "{{OLD}}",
      },
      settings: DEFAULT_BLOG_SETTINGS,
    });
    expect(preview.blogIdentityFieldsChanged).toEqual([
      "name",
      "description",
      "keywords",
      "aiPromptTemplate",
    ]);
    expect(preview.includesBlogIdentity).toBe(true);
  });
});

describe("buildBlogSettingsTemplateAiPrompt", () => {
  it("returns a generic prompt when no topic is provided", () => {
    expect(buildBlogSettingsTemplateAiPrompt()).toMatch(
      /Edit this SynthPress blog settings JSON for a blog about \[topic\]/,
    );
  });

  it("substitutes the supplied topic", () => {
    expect(
      buildBlogSettingsTemplateAiPrompt("indie hacker storytelling"),
    ).toMatch(/about indie hacker storytelling/);
  });
});

describe("buildBlogSettingsTemplateAiGuideText", () => {
  it("instructs the AI to keep kind + schemaVersion exact", () => {
    const guide = buildBlogSettingsTemplateAiGuideText();
    expect(guide).toMatch(/Keep `kind` exactly/);
    expect(guide).toContain(BLOG_SETTINGS_TEMPLATE_KIND);
    expect(guide).toMatch(
      new RegExp(
        `Keep \`schemaVersion\` as \`${BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION}\``,
      ),
    );
  });

  it("says return valid JSON only", () => {
    const guide = buildBlogSettingsTemplateAiGuideText();
    expect(guide).toMatch(/Return valid JSON only/i);
    expect(guide).toMatch(/Return JSON only\./);
  });

  it("forbids adding WordPress credentials or secrets", () => {
    const guide = buildBlogSettingsTemplateAiGuideText();
    expect(guide).toMatch(/Do NOT add WordPress credentials/i);
    expect(guide).toMatch(/wp_url/);
    expect(guide).toMatch(/wp_username/);
    expect(guide).toMatch(/wp_app_password/);
    expect(guide).toMatch(/Do NOT add team IDs.*API keys.*secrets/);
  });

  it("forbids setting automation.enabled to true and locks pause fields", () => {
    const guide = buildBlogSettingsTemplateAiGuideText();
    expect(guide).toMatch(
      /Do NOT set `settings\.automation\.enabled` to `true`/,
    );
    expect(guide).toMatch(/import always forces it to `false`/);
    expect(guide).toMatch(/`settings\.automation\.pausedAt`/);
    expect(guide).toMatch(/`settings\.automation\.pausedReason`/);
    expect(guide).toMatch(/`settings\.automation\.pausedMessage`/);
  });

  it("includes enum values for the closed-enum settings fields", () => {
    const guide = buildBlogSettingsTemplateAiGuideText();
    // Sample one value from every enum family to lock the
    // generated-from-constants behavior.
    expect(guide).toContain("`elementary`"); // readingLevel
    expect(guide).toContain("`first_person_singular`"); // pointOfView
    expect(guide).toContain("`evergreen`"); // contentFreshness
    expect(guide).toContain("`balanced`"); // keywordUsage
    expect(guide).toContain("`occasional`"); // linkingPreference
    expect(guide).toContain("`lowercase-hyphenated`"); // slugFormat
    expect(guide).toContain("`when_relevant`"); // featuredImagePreference
    expect(guide).toContain("`autopilot`"); // automation.mode
    expect(guide).toContain("`Mon`"); // preferredDays
    expect(guide).toContain("`wordpress`"); // publishing.defaultDestination
    expect(guide).toContain("`draft`"); // publishing.defaultStatus
  });

  it("includes goal + article type enum values", () => {
    const guide = buildBlogSettingsTemplateAiGuideText();
    expect(guide).toContain("`educate`");
    expect(guide).toContain("`affiliate`");
    expect(guide).toContain("`how_to`");
    expect(guide).toContain("`listicle`");
  });

  it("lists Pexels + None as the active media.imageProvider values", () => {
    const guide = buildBlogSettingsTemplateAiGuideText();
    expect(guide).toMatch(/### media\.imageProvider \(active\)/);
    // The pexels + none rows should appear UNDER the active heading.
    const providerIdx = guide.indexOf("### media.imageProvider (active)");
    expect(providerIdx).toBeGreaterThan(0);
    const providerSection = guide.slice(providerIdx, providerIdx + 200);
    expect(providerSection).toContain("`pexels`");
    expect(providerSection).toContain("`none`");
  });

  it("flags MVP-active vs legacy/future media fields", () => {
    const guide = buildBlogSettingsTemplateAiGuideText();
    expect(guide).toMatch(/Active media fields/);
    expect(guide).toContain("`media.autoPickImages`");
    expect(guide).toContain("`media.imageProvider`");
    expect(guide).toContain("`media.includeInlineImages`");
    expect(guide).toMatch(/Legacy \/ future media fields/);
    expect(guide).toContain("`media.imageSource`");
    expect(guide).toContain("`media.generateFeaturedImage`");
  });

  it("notes autopilot is WordPress drafts only (not live publish)", () => {
    const guide = buildBlogSettingsTemplateAiGuideText();
    expect(guide).toMatch(
      /Autopilot currently sends WordPress drafts only — never live publish/,
    );
    expect(guide).toContain("`publishing.autoSendToWordPressDraft`");
  });

  it("substitutes the provided topic into the Task line", () => {
    const guide = buildBlogSettingsTemplateAiGuideText({
      topic: "indie hacker storytelling",
    });
    expect(guide).toMatch(/for a blog about indie hacker storytelling/);
  });

  it("falls back to [topic] when topic is empty/whitespace", () => {
    const guide = buildBlogSettingsTemplateAiGuideText({ topic: "  " });
    expect(guide).toMatch(/for a blog about \[topic\]/);
  });

  it("renders headings for every closed-enum section", () => {
    const guide = buildBlogSettingsTemplateAiGuideText();
    for (const heading of [
      "### identity.readingLevel",
      "### identity.pointOfView",
      "### strategy.goals (array)",
      "### strategy.preferredArticleTypes (array of slugs)",
      "### strategy.contentFreshness",
      "### seo.keywordUsage",
      "### seo.internalLinkingPreference / seo.externalLinkingPreference",
      "### seo.slugFormat",
      "### seo.featuredImagePreference",
      "### automation.mode",
      "### automation.preferredDays (array)",
      "### publishing.defaultDestination",
      "### publishing.defaultStatus",
      "### media.imageSource (legacy / future)",
    ]) {
      expect(guide).toContain(heading);
    }
  });
});

describe("buildBlogSettingsTemplateAiGuide (guide + JSON appendix)", () => {
  it("appends the JSON in a fenced code block", () => {
    const tmpl = buildBlogSettingsTemplate({
      blog: { name: "Indie" },
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: FIXED_TS,
    });
    const json = serializeBlogSettingsTemplate(tmpl);
    const out = buildBlogSettingsTemplateAiGuide({
      templateJson: json,
      topic: "indie hackers",
    });
    expect(out).toMatch(/## Template JSON/);
    expect(out).toContain("```json\n");
    expect(out).toContain(json);
    expect(out).toMatch(/```\n$/); // trailing newline + closing fence
  });

  it("preserves the topic substitution in the guide section", () => {
    const out = buildBlogSettingsTemplateAiGuide({
      templateJson: "{}",
      topic: "indie hackers",
    });
    expect(out).toMatch(/for a blog about indie hackers/);
  });

  it("contains the JSON exactly once (no duplicate embed)", () => {
    const tmpl = buildBlogSettingsTemplate({
      blog: { name: "Indie" },
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: FIXED_TS,
    });
    const json = serializeBlogSettingsTemplate(tmpl);
    const out = buildBlogSettingsTemplateAiGuide({ templateJson: json });
    // The fenced JSON should appear once. The instruction prose
    // references field names but never the full JSON payload.
    expect(out.split(json).length - 1).toBe(1);
  });
});

describe("buildBlogSettingsTemplateJsonSchema", () => {
  it("returns a draft-2020-12 object schema with the canonical title", () => {
    const schema = buildBlogSettingsTemplateJsonSchema();
    expect(schema.$schema).toMatch(/json-schema\.org/);
    expect(schema.type).toBe("object");
    expect(schema.title).toMatch(/SynthPress Blog Settings Template/);
  });

  it("requires the three discriminator fields", () => {
    const schema = buildBlogSettingsTemplateJsonSchema();
    expect(schema.required).toEqual(["kind", "schemaVersion", "settings"]);
  });

  it("pins `kind` and `schemaVersion` to their canonical const values", () => {
    const schema = buildBlogSettingsTemplateJsonSchema();
    const props = schema.properties as Record<string, { const?: unknown }>;
    expect(props.kind.const).toBe(BLOG_SETTINGS_TEMPLATE_KIND);
    expect(props.schemaVersion.const).toBe(
      BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
    );
  });

  it("exposes enum values for the major settings fields", () => {
    const schema = buildBlogSettingsTemplateJsonSchema();
    const settings = (
      schema.properties as Record<
        string,
        { properties: Record<string, unknown> }
      >
    ).settings;
    const identity = (
      settings.properties as Record<
        string,
        { properties: Record<string, unknown> }
      >
    ).identity;
    const readingLevel = (
      identity.properties as Record<string, { enum?: string[] }>
    ).readingLevel;
    expect(readingLevel.enum).toEqual([
      "elementary",
      "intermediate",
      "advanced",
      "expert",
    ]);
  });

  it("disallows additionalProperties at the top level so AI tools don't add stray keys", () => {
    const schema = buildBlogSettingsTemplateJsonSchema();
    expect(schema.additionalProperties).toBe(false);
  });

  it("documents the system-managed automation fields as wiped on import", () => {
    const schema = buildBlogSettingsTemplateJsonSchema();
    const automation = (
      (
        schema.properties as Record<
          string,
          { properties: Record<string, unknown> }
        >
      ).settings.properties as Record<
        string,
        { properties: Record<string, { description?: string }> }
      >
    ).automation;
    expect(automation.properties.pausedAt.description).toMatch(
      /wiped on import/i,
    );
    expect(automation.properties.enabled.description).toMatch(
      /forced to `false`/i,
    );
  });
});

describe("import safety — schema/guide adornments are ignored", () => {
  function freshTemplateJson(
    overrides: Partial<Record<string, unknown>> = {},
  ): string {
    return JSON.stringify({
      kind: BLOG_SETTINGS_TEMPLATE_KIND,
      schemaVersion: BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
      settings: DEFAULT_BLOG_SETTINGS,
      ...overrides,
    });
  }

  it("ignores a `_aiGuide` adornment field with a warning, not an error", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({
        _aiGuide: "Here is some helpful guidance from an AI tool.",
      }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.warnings.join("\n")).toMatch(
      /Ignored unknown top-level fields: .*_aiGuide/,
    );
    expect(result.normalizedTemplate).not.toHaveProperty("_aiGuide");
  });

  it("ignores a `_schema` adornment field", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({
        _schema: { hint: "json-schema reference embedded by AI" },
      }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.warnings.join("\n")).toMatch(/_schema/);
    expect(result.normalizedTemplate).not.toHaveProperty("_schema");
  });

  it("ignores a `$schema` adornment field (JSON-schema convention)", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({ $schema: "https://example.com/synthpress.json" }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.warnings.join("\n")).toMatch(/\$schema/);
    expect(result.normalizedTemplate).not.toHaveProperty("$schema");
  });

  it("ignores multiple guide-shaped adornments in one go", () => {
    const result = parseBlogSettingsTemplateJson(
      freshTemplateJson({
        _aiGuide: "...",
        _schema: { foo: 1 },
        schema: "another",
      }),
    );
    if (!result.ok) throw new Error("expected ok");
    const warning = result.warnings.find((w) =>
      w.startsWith("Ignored unknown top-level fields"),
    );
    expect(warning).toMatch(/_aiGuide/);
    expect(warning).toMatch(/_schema/);
    expect(warning).toMatch(/schema/);
    // The valid keys (kind/schemaVersion/settings) should still be
    // present after normalization.
    expect(result.normalizedTemplate.kind).toBe(BLOG_SETTINGS_TEMPLATE_KIND);
    expect(result.normalizedTemplate.schemaVersion).toBe(
      BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
    );
  });
});
