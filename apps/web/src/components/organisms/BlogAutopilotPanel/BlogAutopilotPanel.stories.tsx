import type { Meta, StoryObj } from "@storybook/react";
import type { AutopilotRunRowData } from "@/components/molecules/AutopilotRunRow";
import { BlogAutopilotPanel } from "./BlogAutopilotPanel";

const NOW = new Date().toISOString();

function run(overrides: Partial<AutopilotRunRowData>): AutopilotRunRowData {
  return {
    id: Math.random().toString(36).slice(2),
    status: "completed",
    triggerSource: "cron",
    currentStep: "completed",
    errorMessage: null,
    output: { reason: "ok" },
    ideasGenerated: 0,
    articlesStarted: 0,
    articlesCompleted: 0,
    articlesFailed: 0,
    tokensSpent: 0,
    tokensRefunded: 0,
    wpDraftsExpected: 0,
    wpDraftsCreated: 0,
    wpDraftsAlreadySent: 0,
    wpDraftsSkipped: 0,
    wpDraftsFailed: 0,
    createdAt: NOW,
    startedAt: NOW,
    completedAt: NOW,
    ...overrides,
  };
}

const meta = {
  title: "Organisms/BlogAutopilotPanel",
  component: BlogAutopilotPanel,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof BlogAutopilotPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EnabledWithRuns: Story = {
  args: {
    blogName: "Indie Hacker Stories",
    autopilotEnabled: true,
    automationSettingsHref: "#automation",
    recentRuns: [
      run({
        status: "completed",
        triggerSource: "manual",
        articlesStarted: 2,
        tokensSpent: 10,
      }),
      run({
        status: "skipped",
        triggerSource: "cron",
        output: { reason: "daily_article_cap_reached" },
      }),
      run({
        status: "failed",
        triggerSource: "cron",
        currentStep: "generating_ideas",
        errorMessage:
          "Idea generation failed: Anthropic returned 529 (overloaded).",
      }),
    ],
    onRunNow: () => {},
    isRunning: false,
  },
};

export const Disabled: Story = {
  args: {
    blogName: "Daily AI News",
    autopilotEnabled: false,
    automationSettingsHref: "#automation",
    recentRuns: [],
    onRunNow: () => {},
  },
};

export const Empty: Story = {
  args: {
    blogName: "Fresh Blog",
    autopilotEnabled: true,
    automationSettingsHref: "#automation",
    recentRuns: [],
    onRunNow: () => {},
  },
};

export const SuccessMessage: Story = {
  args: {
    blogName: "Indie Hacker Stories",
    autopilotEnabled: true,
    recentRuns: [],
    onRunNow: () => {},
    resultMessage: {
      kind: "success",
      message: "Autopilot started 2 article jobs.",
    },
  },
};

export const ErrorMessage: Story = {
  args: {
    blogName: "Indie Hacker Stories",
    autopilotEnabled: true,
    recentRuns: [],
    onRunNow: () => {},
    resultMessage: {
      kind: "error",
      message: "Could not run autopilot: supabase down.",
    },
  },
};

/**
 * What the user sees after the scheduler auto-pauses the blog: an
 * amber warning that distinguishes the system pause from a normal
 * user-disabled state and links them to the Automation tab to
 * re-arm autopilot once they've reviewed the failures.
 */
export const PausedAfterFailures: Story = {
  args: {
    blogName: "Daily AI News",
    autopilotEnabled: false,
    automationSettingsHref: "#automation",
    pausedReason: "failure_rate",
    pausedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    pausedMessage:
      "Autopilot was paused because multiple recent runs failed. Review recent runs, then re-enable autopilot when you're ready.",
    recentRuns: [
      run({
        status: "failed",
        triggerSource: "cron",
        currentStep: "generating_ideas",
        errorMessage: "Idea generation failed: Anthropic returned 529.",
      }),
      run({
        status: "failed",
        triggerSource: "cron",
        currentStep: "generating_ideas",
        errorMessage: "Idea generation failed: Anthropic returned 529.",
      }),
      run({
        status: "failed",
        triggerSource: "manual",
        currentStep: "loading_settings",
        errorMessage: "Team billing unavailable.",
      }),
    ],
    onRunNow: () => {},
  },
};
