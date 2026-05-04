import type { Meta, StoryObj } from "@storybook/react";
import { PricingCard } from "./PricingCard";

const meta = {
  title: "Molecules/PricingCard",
  component: PricingCard,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof PricingCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { name: "Starter", price: "$29", description: "For solo creators", features: ["1 WordPress site", "30 articles/month", "AI article generation", "Auto-publishing"] },
};

export const Popular: Story = {
  args: { name: "Pro", price: "$79", description: "For growing networks", features: ["5 WordPress sites", "150 articles/month", "AI article generation", "Auto-publishing", "MSN syndication", "Priority support"], popular: true },
};

export const Scale: Story = {
  args: { name: "Scale", price: "$199", description: "For agencies & networks", features: ["20 WordPress sites", "Unlimited articles", "AI article generation", "Auto-publishing", "MSN syndication", "Dedicated support", "Custom AI prompts"] },
};
