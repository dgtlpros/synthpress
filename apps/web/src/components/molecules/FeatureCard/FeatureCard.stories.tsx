import type { Meta, StoryObj } from "@storybook/react";
import { FeatureCard } from "./FeatureCard";

const meta = {
  title: "Molecules/FeatureCard",
  component: FeatureCard,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof FeatureCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { icon: "✍️", title: "AI Article Generation", description: "GPT-powered long-form content with proper heading structure and SEO optimization." },
};
