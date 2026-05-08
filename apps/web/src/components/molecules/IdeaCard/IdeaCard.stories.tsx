import type { Meta, StoryObj } from "@storybook/react";
import { IdeaCard } from "./IdeaCard";

const meta = {
  title: "Molecules/IdeaCard",
  component: IdeaCard,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof IdeaCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseIdea = {
  id: "i1",
  title: "How to launch a B2B blog in 30 days",
  status: "generated" as const,
  targetKeyword: "launch b2b blog",
  executiveSummary:
    "A practical 30-day playbook covering positioning, keyword research, and the editorial cadence that gets your first ten posts shipped.",
  articleType: "how_to",
  estimatedWordCount: 1500,
  createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
};

export const Generated: Story = { args: { idea: baseIdea } };

export const Approved: Story = {
  args: { idea: { ...baseIdea, status: "approved" } },
};

export const Converted: Story = {
  args: {
    idea: {
      ...baseIdea,
      status: "converted_to_article",
      title: "5 mistakes teams make when adopting AI agents",
      articleType: "listicle",
    },
  },
};

export const ConvertedWithViewArticle: Story = {
  args: {
    idea: {
      ...baseIdea,
      status: "converted_to_article",
      title: "5 mistakes teams make when adopting AI agents",
      articleType: "listicle",
      viewArticleHref: "/teams/t1/projects/p1/blogs/b1/posts/a1",
    },
  },
};

export const Minimal: Story = {
  args: {
    idea: {
      ...baseIdea,
      executiveSummary: null,
      targetKeyword: null,
      estimatedWordCount: null,
      articleType: null,
    },
  },
};

export const WithActions: Story = {
  args: {
    idea: baseIdea,
    onApprove: () => {},
    onReject: () => {},
  },
};

export const ApprovedWithActions: Story = {
  args: {
    idea: { ...baseIdea, status: "approved" },
    onApprove: () => {},
    onReject: () => {},
  },
};

export const RejectedWithActions: Story = {
  args: {
    idea: { ...baseIdea, status: "rejected" },
    onApprove: () => {},
    onReject: () => {},
  },
};

export const ApprovingInFlight: Story = {
  args: {
    idea: baseIdea,
    onApprove: () => {},
    onReject: () => {},
    pendingAction: "approved",
  },
};

export const AnotherCardBusy: Story = {
  args: {
    idea: baseIdea,
    onApprove: () => {},
    onReject: () => {},
    pendingAction: "other",
  },
};

export const WithError: Story = {
  args: {
    idea: baseIdea,
    onApprove: () => {},
    onReject: () => {},
    errorMessage: "This idea can't be changed to that status.",
  },
};

export const ApprovedWithGenerate: Story = {
  args: {
    idea: { ...baseIdea, status: "approved" },
    onApprove: () => {},
    onReject: () => {},
    onGenerate: () => {},
  },
};

export const GeneratingArticle: Story = {
  args: {
    idea: { ...baseIdea, status: "approved" },
    onApprove: () => {},
    onReject: () => {},
    onGenerate: () => {},
    pendingAction: "generating",
  },
};

export const GenerateArticleError: Story = {
  args: {
    idea: { ...baseIdea, status: "approved" },
    onApprove: () => {},
    onReject: () => {},
    onGenerate: () => {},
    errorMessage: "Not enough synth tokens to generate an article.",
  },
};
