import type { Meta, StoryObj } from "@storybook/react";
import { TopUpCard } from "./TopUpCard";
import { Button } from "@/components/atoms/Button";

const meta = {
  title: "Molecules/TopUpCard",
  component: TopUpCard,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof TopUpCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    name: "2,000 synth tokens",
    description: "Best value for the average month",
    tokens: 2000,
    priceCents: 5900,
    cta: <Button className="w-full">Buy now</Button>,
  },
};

export const Highlighted: Story = {
  args: {
    name: "10,000 synth tokens",
    description: "Bulk pack for heavy production months",
    tokens: 10000,
    priceCents: 24900,
    highlighted: true,
    cta: <Button className="w-full">Buy now</Button>,
  },
};
