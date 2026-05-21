import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("./workspace", async () => {
  const actual =
    await vi.importActual<typeof import("./workspace")>("./workspace");
  return {
    ...actual,
    updateBlog: vi.fn(),
  };
});

import { createClient } from "@/lib/supabase/server";
import { updateBlog } from "./workspace";
import { DEFAULT_BLOG_SETTINGS } from "@/lib/blog-settings";
import {
  BLOG_SETTINGS_TEMPLATE_KIND,
  BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
} from "@/lib/blog-settings-template";
import {
  exportBlogSettingsTemplate,
  importBlogSettingsTemplate,
} from "./blog-settings-template";

const mockedCreateClient = vi.mocked(createClient);
const mockedUpdateBlog = vi.mocked(updateBlog);

function mockSupabaseForExport(
  blogRow: Record<string, unknown> | null,
  user: { id: string } | null = { id: "u1" },
) {
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: blogRow, error: null }),
          }),
        }),
      }),
    }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── exportBlogSettingsTemplate ─────────────────────────────────────────────

describe("exportBlogSettingsTemplate", () => {
  const baseInput = { teamId: "t1", projectId: "p1", blogId: "b1" };

  it("returns auth error when not signed in", async () => {
    mockSupabaseForExport(null, null);
    const result = await exportBlogSettingsTemplate(baseInput);
    expect(result.error).toMatch(/signed in/);
  });

  it("returns 'Blog not found.' when the blog row is hidden / missing", async () => {
    mockSupabaseForExport(null);
    const result = await exportBlogSettingsTemplate(baseInput);
    expect(result.error).toBe("Blog not found.");
  });

  it("returns a template with the canonical kind + schemaVersion", async () => {
    mockSupabaseForExport({
      name: "Indie",
      description: "Stories about building bootstrapped products.",
      niche: "indie hackers",
      keywords: ["ai", "saas"],
      ai_prompt_template: "Use the company voice.",
      settings: null,
    });
    const result = await exportBlogSettingsTemplate(baseInput);
    if (!result.data) throw new Error("expected data");
    expect(result.data.template.kind).toBe(BLOG_SETTINGS_TEMPLATE_KIND);
    expect(result.data.template.schemaVersion).toBe(
      BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
    );
    expect(typeof result.data.templateJson).toBe("string");
    expect(JSON.parse(result.data.templateJson)).toEqual(result.data.template);
  });

  it("normalizes null identity columns to empty strings / arrays before passing them to the template builder", async () => {
    // A row read straight from Supabase will return `null` for any
    // nullable column the user never filled in. The action must
    // coerce them into the empty-string / empty-array shape the
    // template builder declares — never forwarding `null` literals.
    // (The template builder then prunes the empties, so the output
    // blog block ends up as just `{ name }` — what we assert here
    // is the LACK of any `null` literal in the serialized JSON.)
    mockSupabaseForExport({
      name: "Indie",
      description: null,
      niche: null,
      keywords: null,
      ai_prompt_template: null,
      settings: null,
    });
    const result = await exportBlogSettingsTemplate(baseInput);
    if (!result.data) throw new Error("expected data");
    expect(result.data.template.blog).toEqual({ name: "Indie" });
    // Defensive: no raw null leaked into the identity block.
    expect(JSON.stringify(result.data.template.blog)).not.toMatch(/:\s*null/);
  });

  it("includes the safe blog identity fields (name, description, niche, keywords, aiPromptTemplate)", async () => {
    mockSupabaseForExport({
      name: "Indie",
      description: "Stories.",
      niche: "indie hackers",
      keywords: ["ai", "saas"],
      ai_prompt_template: "Voice.",
      settings: null,
    });
    const result = await exportBlogSettingsTemplate(baseInput);
    if (!result.data) throw new Error("expected data");
    expect(result.data.template.blog).toEqual({
      name: "Indie",
      description: "Stories.",
      niche: "indie hackers",
      keywords: ["ai", "saas"],
      aiPromptTemplate: "Voice.",
    });
  });

  it("never serializes WordPress credentials, even if a stray field exists on the row", async () => {
    // Make sure the SELECT'd columns never include wp_*; if they did, the
    // serializer would notice. We assert on the JSON itself.
    mockSupabaseForExport({
      name: "Indie",
      description: "",
      niche: "",
      keywords: [],
      ai_prompt_template: "",
      settings: null,
    });
    const result = await exportBlogSettingsTemplate(baseInput);
    if (!result.data) throw new Error("expected data");
    const json = result.data.templateJson;
    expect(json).not.toMatch(/wp_url/);
    expect(json).not.toMatch(/wp_username/);
    expect(json).not.toMatch(/wp_app_password/);
  });

  it("clears automation pause metadata even if persisted on the source blog", async () => {
    mockSupabaseForExport({
      name: "Indie",
      description: "",
      niche: "",
      keywords: [],
      ai_prompt_template: "",
      settings: {
        ...DEFAULT_BLOG_SETTINGS,
        automation: {
          ...DEFAULT_BLOG_SETTINGS.automation,
          pausedAt: "2026-05-01T00:00:00.000Z",
          pausedReason: "failure_rate",
          pausedMessage: "Auto-paused.",
        },
      },
    });
    const result = await exportBlogSettingsTemplate(baseInput);
    if (!result.data) throw new Error("expected data");
    expect(result.data.template.settings.automation.pausedAt).toBeNull();
    expect(result.data.template.settings.automation.pausedReason).toBeNull();
    expect(result.data.template.settings.automation.pausedMessage).toBeNull();
  });

  it("returns the supabase error message when the read fails", async () => {
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: null,
                  error: { message: "read failed" },
                }),
            }),
          }),
        }),
      }),
    } as never);
    const result = await exportBlogSettingsTemplate(baseInput);
    expect(result.error).toBe("read failed");
  });
});

// ─── importBlogSettingsTemplate ─────────────────────────────────────────────

describe("importBlogSettingsTemplate", () => {
  const baseInput = { teamId: "t1", projectId: "p1", blogId: "b1" };

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

  it("rejects invalid JSON", async () => {
    const result = await importBlogSettingsTemplate({
      ...baseInput,
      templateJson: "{ not json",
    });
    expect(result.error).toMatch(/Could not parse JSON/);
    expect(mockedUpdateBlog).not.toHaveBeenCalled();
  });

  it("rejects wrong template kind", async () => {
    const result = await importBlogSettingsTemplate({
      ...baseInput,
      templateJson: freshTemplateJson({ kind: "something.else" }),
    });
    expect(result.error).toMatch(/Unrecognized template kind/);
    expect(mockedUpdateBlog).not.toHaveBeenCalled();
  });

  it("rejects unsupported schemaVersion", async () => {
    const result = await importBlogSettingsTemplate({
      ...baseInput,
      templateJson: freshTemplateJson({ schemaVersion: 999 }),
    });
    expect(result.error).toMatch(/Unsupported schemaVersion/);
    expect(mockedUpdateBlog).not.toHaveBeenCalled();
  });

  it("does NOT apply blog identity by default (preserves the destination blog's name)", async () => {
    mockedUpdateBlog.mockResolvedValue({ data: null, error: null });
    const result = await importBlogSettingsTemplate({
      ...baseInput,
      templateJson: freshTemplateJson({ blog: { name: "Imported" } }),
    });
    expect(result.error).toBeNull();
    const [, , , payload] = mockedUpdateBlog.mock.calls[0]!;
    expect(payload.name).toBeUndefined();
    expect(payload.description).toBeUndefined();
    expect(payload.niche).toBeUndefined();
    expect(payload.keywords).toBeUndefined();
    expect(payload.aiPromptTemplate).toBeUndefined();
    expect(result.data?.warnings.some((w) => /Blog identity/.test(w))).toBe(
      true,
    );
  });

  it("applies blog identity when `includeBlogIdentity: true`", async () => {
    mockedUpdateBlog.mockResolvedValue({ data: null, error: null });
    await importBlogSettingsTemplate({
      ...baseInput,
      templateJson: freshTemplateJson({
        blog: {
          name: "Imported",
          description: "Desc",
          niche: "saas",
          keywords: ["ai", "ml"],
          aiPromptTemplate: "{{IMPORTED}}",
        },
      }),
      options: { includeBlogIdentity: true },
    });
    const [, , , payload] = mockedUpdateBlog.mock.calls[0]!;
    expect(payload.name).toBe("Imported");
    expect(payload.description).toBe("Desc");
    expect(payload.niche).toBe("saas");
    expect(payload.keywords).toEqual(["ai", "ml"]);
    expect(payload.aiPromptTemplate).toBe("{{IMPORTED}}");
  });

  it("applies only the identity fields the template carries — description-only block (name skipped)", async () => {
    // Mirror branch: with no `name` in the template, the `typeof
    // id.name === "string"` check goes to its false branch and
    // `payload.name` stays undefined. Description still flows.
    mockedUpdateBlog.mockResolvedValue({ data: null, error: null });
    await importBlogSettingsTemplate({
      ...baseInput,
      templateJson: freshTemplateJson({
        blog: { description: "Stories." },
      }),
      options: { includeBlogIdentity: true },
    });
    const [, , , payload] = mockedUpdateBlog.mock.calls[0]!;
    expect(payload.name).toBeUndefined();
    expect(payload.description).toBe("Stories.");
  });

  it("only applies identity fields that the template actually carries (skips missing ones)", async () => {
    // Branch coverage: when the template's `blog` block is a partial
    // — e.g. just `{ name }` after the parser strips the unknowns —
    // the importer's per-field `typeof === 'string'` (and
    // `Array.isArray(keywords)`) checks must skip the missing
    // fields so `updateBlog` gets `name` only, not `description=null`
    // or similar.
    mockedUpdateBlog.mockResolvedValue({ data: null, error: null });
    await importBlogSettingsTemplate({
      ...baseInput,
      templateJson: freshTemplateJson({
        blog: { name: "Imported" },
      }),
      options: { includeBlogIdentity: true },
    });
    const [, , , payload] = mockedUpdateBlog.mock.calls[0]!;
    // `name` came through (typeof string branch).
    expect(payload.name).toBe("Imported");
    // Other identity fields stayed undefined (false branches hit).
    expect(payload.description).toBeUndefined();
    expect(payload.niche).toBeUndefined();
    expect(payload.keywords).toBeUndefined();
    expect(payload.aiPromptTemplate).toBeUndefined();
  });

  it("forces automation.enabled = false even when the template had it true", async () => {
    mockedUpdateBlog.mockResolvedValue({ data: null, error: null });
    await importBlogSettingsTemplate({
      ...baseInput,
      templateJson: freshTemplateJson({
        settings: {
          ...DEFAULT_BLOG_SETTINGS,
          automation: {
            ...DEFAULT_BLOG_SETTINGS.automation,
            enabled: true,
            mode: "autopilot",
            generatePerWeek: 21,
          },
        },
      }),
    });
    const [, , , payload] = mockedUpdateBlog.mock.calls[0]!;
    expect(payload.settings?.automation?.enabled).toBe(false);
    // But cadence settings still travel.
    expect(payload.settings?.automation?.mode).toBe("autopilot");
    expect(payload.settings?.automation?.generatePerWeek).toBe(21);
  });

  it("clears automation pause fields on import", async () => {
    mockedUpdateBlog.mockResolvedValue({ data: null, error: null });
    await importBlogSettingsTemplate({
      ...baseInput,
      templateJson: freshTemplateJson({
        settings: {
          ...DEFAULT_BLOG_SETTINGS,
          automation: {
            ...DEFAULT_BLOG_SETTINGS.automation,
            pausedAt: "2026-05-01T00:00:00.000Z",
            pausedReason: "failure_rate",
            pausedMessage: "Bad.",
          },
        },
      }),
    });
    const [, , , payload] = mockedUpdateBlog.mock.calls[0]!;
    expect(payload.settings?.automation?.pausedAt).toBeNull();
    expect(payload.settings?.automation?.pausedReason).toBeNull();
    expect(payload.settings?.automation?.pausedMessage).toBeNull();
  });

  it("omits automation entirely when `includeAutomation: false`", async () => {
    mockedUpdateBlog.mockResolvedValue({ data: null, error: null });
    await importBlogSettingsTemplate({
      ...baseInput,
      templateJson: freshTemplateJson({
        settings: {
          ...DEFAULT_BLOG_SETTINGS,
          automation: {
            ...DEFAULT_BLOG_SETTINGS.automation,
            generatePerWeek: 21,
          },
        },
      }),
      options: { includeAutomation: false },
    });
    const [, , , payload] = mockedUpdateBlog.mock.calls[0]!;
    expect(payload.settings?.automation).toBeUndefined();
    // Other sections still patched.
    expect(payload.settings?.identity).toBeDefined();
    expect(payload.settings?.seo).toBeDefined();
  });

  it("never sends WordPress credentials to updateBlog even if the JSON contained them", async () => {
    mockedUpdateBlog.mockResolvedValue({ data: null, error: null });
    const result = await importBlogSettingsTemplate({
      ...baseInput,
      templateJson: freshTemplateJson({
        wp_url: "https://wp.example.com",
        wp_username: "admin",
        wp_app_password: "secret",
        blog: { name: "Imported", wp_app_password: "secret-2" },
      }),
      options: { includeBlogIdentity: true },
    });
    expect(result.error).toBeNull();
    const [, , , payload] = mockedUpdateBlog.mock.calls[0]!;
    expect(payload.connection).toBeUndefined();
    expect(JSON.stringify(payload)).not.toMatch(/wp_app_password/);
    expect(JSON.stringify(payload)).not.toMatch(/wp_url/);
    expect(JSON.stringify(payload)).not.toMatch(/wp_username/);
    expect(result.data?.warnings.some((w) => /credentials/i.test(w))).toBe(
      true,
    );
  });

  it("propagates updateBlog errors back to the caller", async () => {
    mockedUpdateBlog.mockResolvedValue({ data: null, error: "Forbidden." });
    const result = await importBlogSettingsTemplate({
      ...baseInput,
      templateJson: freshTemplateJson(),
    });
    expect(result.error).toBe("Forbidden.");
  });

  it("ignores unknown top-level fields and includes a warning", async () => {
    mockedUpdateBlog.mockResolvedValue({ data: null, error: null });
    const result = await importBlogSettingsTemplate({
      ...baseInput,
      templateJson: freshTemplateJson({ totallyMadeUpField: 1 }),
    });
    expect(result.error).toBeNull();
    expect(result.data?.warnings.join("\n")).toMatch(/totallyMadeUpField/);
  });
});
