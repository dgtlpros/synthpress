import type { Meta, StoryObj } from "@storybook/react";
import { ActiveJobRow } from "./ActiveJobRow";
import type { ActiveArticleJobRow } from "@/lib/active-jobs";

const baseJob: ActiveArticleJobRow = {
  id: "job-1",
  type: "generate_article",
  status: "processing",
  currentStep: "writing_article",
  errorMessage: null,
  output: null,
  createdAt: "2026-05-11T00:00:00Z",
  startedAt: "2026-05-11T00:00:01Z",
  completedAt: null,
  ideaId: "i1",
  blog: {
    id: "b1",
    name: "Indie Hacker Stories",
    projectId: "p1",
    teamId: "t1",
  },
  article: {
    id: "article-1",
    title: "How to launch a B2B blog in 30 days",
    status: "generating",
  },
};

const meta = {
  title: "Molecules/ActiveJobRow",
  component: ActiveJobRow,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof ActiveJobRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Processing: Story = {
  args: {
    job: baseJob,
    onDismiss: () => {},
  },
};

export const Pending: Story = {
  args: {
    job: { ...baseJob, status: "pending", currentStep: null },
    onDismiss: () => {},
  },
};

export const Completed: Story = {
  args: {
    job: {
      ...baseJob,
      status: "completed",
      currentStep: "completed",
      completedAt: "2026-05-11T00:02:00Z",
      article: { ...baseJob.article!, status: "ready_for_review" },
    },
    onDismiss: () => {},
  },
};

export const Failed: Story = {
  args: {
    job: {
      ...baseJob,
      status: "failed",
      errorMessage: "No object generated: response did not match schema.",
      completedAt: "2026-05-11T00:02:00Z",
      article: { ...baseJob.article!, status: "failed" },
    },
    onDismiss: () => {},
  },
};

export const FailedRefunded: Story = {
  args: {
    job: {
      ...baseJob,
      status: "failed",
      errorMessage: "Anthropic returned a 529 (overloaded).",
      completedAt: "2026-05-11T00:02:00Z",
      output: { refunded: true, refundedCredits: 5 },
      article: { ...baseJob.article!, status: "failed" },
    },
    onDismiss: () => {},
  },
};
