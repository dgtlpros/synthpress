import type { Meta, StoryObj } from "@storybook/react";
import { ArticleDetail } from "./ArticleDetail";

const meta = {
  title: "Organisms/ArticleDetail",
  component: ArticleDetail,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof ArticleDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseArticle = {
  id: "a1",
  title: "How to launch a B2B blog in 30 days",
  slug: "how-to-launch-a-b2b-blog-in-30-days",
  status: "ready_for_review" as const,
  excerpt: "A practical 30-day plan to ship your first ten posts.",
  metaDescription:
    "Step-by-step playbook for launching a B2B blog in 30 days, with weekly milestones.",
  targetKeyword: "launch a b2b blog",
  contentMarkdown: `# How to launch a B2B blog in 30 days

Launching a B2B blog is mostly about discipline. Here's the four-week plan.

## Week 1: positioning

Start by clarifying the audience.

## Week 2: research

Build the keyword + topic map.
`,
  wordCount: 1623,
  generatedByModel: "claude-sonnet-4-6",
  errorMessage: null,
  updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  wpPostId: null,
  wpPostUrl: null,
};

export const Default: Story = {
  args: { article: baseArticle, onEdit: () => {} },
};

export const WithoutEditButton: Story = {
  args: { article: baseArticle },
};

export const Failed: Story = {
  args: {
    article: {
      ...baseArticle,
      status: "failed",
      contentMarkdown: null,
      errorMessage: "Anthropic API timed out after 60 seconds.",
    },
    onEdit: () => {},
  },
};

export const Generating: Story = {
  args: {
    article: {
      ...baseArticle,
      status: "generating",
      contentMarkdown: null,
    },
  },
};
