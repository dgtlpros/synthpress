import type { Meta, StoryObj } from "@storybook/react";
import { DEFAULT_BLOG_SETTINGS } from "@/lib/blog-settings";
import { BlogSettingsTabs } from "./BlogSettingsTabs";

const meta = {
  title: "Organisms/BlogSettingsTabs",
  component: BlogSettingsTabs,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof BlogSettingsTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    initialValue: {
      general: {
        name: "Indie Hacker Stories",
        description: "Stories about building bootstrapped products.",
        niche: "Indie hackers",
        keywordsText: "indie, micro-saas, bootstrapping",
        aiPromptTemplate: "",
      },
      settings: DEFAULT_BLOG_SETTINGS,
    },
    onSave: () => {},
  },
};

export const AutopilotConfigured: Story = {
  args: {
    initialValue: {
      general: {
        name: "Indie Hacker Stories",
        description: "Stories about building bootstrapped products.",
        niche: "Indie hackers",
        keywordsText: "indie, micro-saas, bootstrapping",
        aiPromptTemplate: "",
      },
      settings: {
        ...DEFAULT_BLOG_SETTINGS,
        automation: {
          ...DEFAULT_BLOG_SETTINGS.automation,
          enabled: true,
          mode: "autopilot",
          generatePerWeek: 14,
          backlogThreshold: 25,
          dailyTokenBudget: 1000,
          timezone: "America/New_York",
        },
      },
    },
    onSave: () => {},
  },
};

export const Saving: Story = {
  args: {
    ...Default.args!,
    isSaving: true,
  },
};
