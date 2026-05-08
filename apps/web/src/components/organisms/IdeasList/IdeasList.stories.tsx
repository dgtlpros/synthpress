import type { Meta, StoryObj } from "@storybook/react";
import { IdeasList } from "./IdeasList";

const meta = {
  title: "Organisms/IdeasList",
  component: IdeasList,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof IdeasList>;

export default meta;
type Story = StoryObj<typeof meta>;

const sample = [
  {
    id: "i1",
    title: "How to launch a B2B blog in 30 days",
    status: "generated" as const,
    targetKeyword: "launch b2b blog",
    executiveSummary:
      "A practical 30-day playbook covering positioning, keyword research, and editorial cadence.",
    articleType: "how_to",
    estimatedWordCount: 1500,
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: "i2",
    title: "5 mistakes teams make when adopting AI agents",
    status: "approved" as const,
    targetKeyword: "AI agents adoption",
    executiveSummary: "Common pitfalls to avoid when rolling out AI agents internally.",
    articleType: "listicle",
    estimatedWordCount: 1200,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
  },
  {
    id: "i3",
    title: "Why durable execution is the next big primitive",
    status: "converted_to_article" as const,
    targetKeyword: "durable execution",
    executiveSummary:
      "Why teams shipping AI infrastructure are moving from queues to durable workflows.",
    articleType: "opinion",
    estimatedWordCount: 1800,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
  },
];

export const WithIdeas: Story = {
  args: { ideas: sample, onGenerateClick: () => {} },
};

export const Empty: Story = {
  args: { ideas: [], onGenerateClick: () => {} },
};

export const Generating: Story = {
  args: { ideas: sample, onGenerateClick: () => {}, isGenerating: true },
};
