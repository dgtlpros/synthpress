import type { Meta, StoryObj } from "@storybook/react";
import { ActiveJobsTray } from "./ActiveJobsTray";
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
  blog: { id: "b1", name: "Indie Hacker Stories", projectId: "p1", teamId: "t1" },
  article: {
    id: "article-1",
    title: "How to launch a B2B blog in 30 days",
    status: "generating",
  },
};

const meta = {
  title: "Organisms/ActiveJobsTray",
  component: ActiveJobsTray,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof ActiveJobsTray>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleActiveJob: Story = {
  args: {
    jobs: [baseJob],
    activeCount: 1,
    onDismiss: () => {},
  },
};

export const MultipleJobsMixed: Story = {
  args: {
    jobs: [
      baseJob,
      {
        ...baseJob,
        id: "job-2",
        status: "pending",
        currentStep: null,
        article: null,
      },
      {
        ...baseJob,
        id: "job-3",
        status: "completed",
        currentStep: "completed",
        completedAt: "2026-05-11T00:01:00Z",
        article: {
          id: "article-3",
          title: "Why indie SaaS wins on niches",
          status: "ready_for_review",
        },
      },
      {
        ...baseJob,
        id: "job-4",
        status: "failed",
        errorMessage: "model schema mismatch",
        completedAt: "2026-05-11T00:02:00Z",
        output: { refunded: true, refundedCredits: 5 },
        article: {
          id: "article-4",
          title: "Half-baked draft",
          status: "failed",
        },
      },
    ],
    activeCount: 2,
    onDismiss: () => {},
  },
};

export const Empty: Story = {
  args: { jobs: [], activeCount: 0, onDismiss: () => {} },
};
