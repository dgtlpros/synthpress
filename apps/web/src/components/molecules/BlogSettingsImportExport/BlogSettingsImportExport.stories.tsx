import type { Meta, StoryObj } from "@storybook/react";
import { DEFAULT_BLOG_SETTINGS } from "@/lib/blog-settings";
import {
  BLOG_SETTINGS_TEMPLATE_KIND,
  BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
  buildBlogSettingsTemplate,
  buildBlogSettingsTemplateChangesPreview,
  serializeBlogSettingsTemplate,
} from "@/lib/blog-settings-template";
import { BlogSettingsImportExport } from "./BlogSettingsImportExport";

const meta = {
  title: "Molecules/BlogSettingsImportExport",
  component: BlogSettingsImportExport,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof BlogSettingsImportExport>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleTemplate = buildBlogSettingsTemplate({
  blog: {
    name: "Indie Hacker Stories",
    description: "Stories about building bootstrapped products.",
    niche: "Indie hackers",
    keywords: ["indie", "micro-saas", "bootstrapping"],
    aiPromptTemplate: "",
  },
  settings: DEFAULT_BLOG_SETTINGS,
  exportedAt: "2026-05-20T18:00:00.000Z",
});
const sampleJson = serializeBlogSettingsTemplate(sampleTemplate);

const sampleChanges = buildBlogSettingsTemplateChangesPreview(sampleTemplate, {
  blog: { name: "Different blog" },
  settings: {
    ...DEFAULT_BLOG_SETTINGS,
    identity: { ...DEFAULT_BLOG_SETTINGS.identity, audience: "Founders" },
  },
});

const noopHandlers = {
  onOpenExportModal: () => {},
  onCloseExportModal: () => {},
  onOpenImportModal: () => {},
  onCloseImportModal: () => {},
  onImportTextareaChange: () => {},
  onReviewImport: () => {},
  onApplyImport: () => {},
};

export const Idle: Story = {
  args: {
    exportTemplateJson: sampleJson,
    exportModalOpen: false,
    importModalOpen: false,
    importTextareaValue: "",
    importState: { phase: "idle" },
    ...noopHandlers,
  },
};

export const ExportModalOpen: Story = {
  args: {
    ...Idle.args!,
    exportModalOpen: true,
  },
};

export const ExportModalWithAiGuide: Story = {
  args: {
    ...Idle.args!,
    exportModalOpen: true,
    aiPromptTopic: "indie hacker storytelling",
  },
};

export const ImportModalOpen: Story = {
  args: {
    ...Idle.args!,
    importModalOpen: true,
  },
};

export const ImportReviewing: Story = {
  args: {
    ...Idle.args!,
    importModalOpen: true,
    importTextareaValue: sampleJson,
    importState: {
      phase: "reviewing",
      preview: {
        template: sampleTemplate,
        changes: sampleChanges,
        warnings: ["Ignored unknown top-level fields: legacyKey."],
      },
    },
  },
};

export const ImportError: Story = {
  args: {
    ...Idle.args!,
    importModalOpen: true,
    importTextareaValue: "{ malformed",
    importState: {
      phase: "error",
      errorMessage: "Could not parse JSON: Unexpected end of JSON input.",
    },
  },
};

export const ImportApplied: Story = {
  args: {
    ...Idle.args!,
    importModalOpen: true,
    importTextareaValue: sampleJson,
    importState: {
      phase: "applied",
      appliedWarnings: [
        "Blog identity (name/description/niche/keywords/prompt template) was not changed. Enable `Include blog identity` to apply it.",
      ],
    },
  },
};

export const SchemaCallouts: Story = {
  args: {
    ...Idle.args!,
    importModalOpen: true,
    importTextareaValue: sampleJson,
    importState: {
      phase: "reviewing",
      preview: {
        template: {
          ...sampleTemplate,
          kind: BLOG_SETTINGS_TEMPLATE_KIND,
          schemaVersion: BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
        },
        changes: sampleChanges,
        warnings: [],
      },
    },
  },
};
