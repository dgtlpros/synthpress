import type { Meta, StoryObj } from "@storybook/react";
import { PriceTag } from "./PriceTag";

const meta = {
  title: "Atoms/PriceTag",
  component: PriceTag,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    size: { control: "select", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof PriceTag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { cents: 2900, period: "/mo" } };
export const Large: Story = {
  args: { cents: 7900, period: "/mo", size: "lg" },
};
export const OneTime: Story = { args: { cents: 1900 } };
export const Decimals: Story = { args: { cents: 1999, period: "/mo" } };
