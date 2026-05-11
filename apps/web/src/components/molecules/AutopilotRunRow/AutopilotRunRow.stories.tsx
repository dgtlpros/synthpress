import type { Meta, StoryObj } from "@storybook/react";
import { AutopilotRunRow } from "./AutopilotRunRow";

const NOW = new Date("2026-05-11T08:30:00Z").toISOString();
const TWO_MIN_AGO = new Date("2026-05-11T08:28:00Z").toISOString();
const THIRTY_MIN_AGO = new Date("2026-05-11T08:00:00Z").toISOString();
const TWO_HOURS_AGO = new Date("2026-05-11T06:30:00Z").toISOString();

const meta = {
  title: "Molecules/AutopilotRunRow",
  component: AutopilotRunRow,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <ul className="max-w-xl divide-y divide-border rounded-[var(--sp-radius-lg)] border border-border bg-surface">
        <Story />
      </ul>
    ),
  ],
} satisfies Meta<typeof AutopilotRunRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CompletedScheduled: Story = {
  args: {
    run: {
      id: "r1",
      status: "completed",
      triggerSource: "cron",
      currentStep: "completed",
      errorMessage: null,
      output: {
        reason: "ok",
        spawnedArticleJobIds: ["j1", "j2", "j3"],
      },
      ideasGenerated: 0,
      articlesStarted: 3,
      articlesCompleted: 0,
      articlesFailed: 0,
      tokensSpent: 15,
      tokensRefunded: 0,
      createdAt: TWO_MIN_AGO,
      startedAt: TWO_MIN_AGO,
      completedAt: NOW,
    },
  },
};

export const CompletedManualWithIdeas: Story = {
  args: {
    run: {
      id: "r2",
      status: "completed",
      triggerSource: "manual",
      currentStep: "completed",
      errorMessage: null,
      output: { reason: "ok" },
      ideasGenerated: 10,
      articlesStarted: 0,
      articlesCompleted: 0,
      articlesFailed: 0,
      tokensSpent: 1,
      tokensRefunded: 0,
      createdAt: THIRTY_MIN_AGO,
      startedAt: THIRTY_MIN_AGO,
      completedAt: THIRTY_MIN_AGO,
    },
  },
};

/**
 * What a fully hands-off autopilot run looks like:
 * `requireReview: false`, ideas were both generated and
 * auto-approved in the same tick, and article workflows started.
 */
export const CompletedAutoApprovedHandsOff: Story = {
  args: {
    run: {
      id: "r2b",
      status: "completed",
      triggerSource: "cron",
      currentStep: "completed",
      errorMessage: null,
      output: {
        reason: "ok",
        ideasAutoApproved: 5,
        requireReview: false,
        spawnedArticleJobIds: ["j1", "j2", "j3"],
      },
      ideasGenerated: 5,
      articlesStarted: 3,
      articlesCompleted: 0,
      articlesFailed: 0,
      tokensSpent: 16,
      tokensRefunded: 0,
      createdAt: TWO_MIN_AGO,
      startedAt: TWO_MIN_AGO,
      completedAt: NOW,
    },
  },
};

export const SkippedDailyCap: Story = {
  args: {
    run: {
      id: "r3",
      status: "skipped",
      triggerSource: "cron",
      currentStep: "completed",
      errorMessage: null,
      output: { reason: "daily_article_cap_reached" },
      ideasGenerated: 0,
      articlesStarted: 0,
      articlesCompleted: 0,
      articlesFailed: 0,
      tokensSpent: 0,
      tokensRefunded: 0,
      createdAt: TWO_HOURS_AGO,
      startedAt: TWO_HOURS_AGO,
      completedAt: TWO_HOURS_AGO,
    },
  },
};

export const Failed: Story = {
  args: {
    run: {
      id: "r4",
      status: "failed",
      triggerSource: "cron",
      currentStep: "generating_ideas",
      errorMessage:
        "Idea generation failed: Anthropic returned 529 (overloaded). The next scheduled tick will retry.",
      output: { stage: "generating_ideas" },
      ideasGenerated: 0,
      articlesStarted: 0,
      articlesCompleted: 0,
      articlesFailed: 0,
      tokensSpent: 0,
      tokensRefunded: 0,
      createdAt: THIRTY_MIN_AGO,
      startedAt: THIRTY_MIN_AGO,
      completedAt: THIRTY_MIN_AGO,
    },
  },
};

export const Processing: Story = {
  args: {
    run: {
      id: "r5",
      status: "processing",
      triggerSource: "manual",
      currentStep: "generating_articles",
      errorMessage: null,
      output: null,
      ideasGenerated: 0,
      articlesStarted: 2,
      articlesCompleted: 0,
      articlesFailed: 0,
      tokensSpent: 10,
      tokensRefunded: 0,
      createdAt: NOW,
      startedAt: NOW,
      completedAt: null,
    },
  },
};
