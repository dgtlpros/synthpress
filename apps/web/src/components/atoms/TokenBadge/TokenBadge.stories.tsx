import type { Meta, StoryObj } from "@storybook/react";
import { TokenBadge } from "./TokenBadge";

const meta = {
  title: "Atoms/TokenBadge",
  component: TokenBadge,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["neutral", "brand", "warning", "lime"],
    },
    size: { control: "select", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof TokenBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { balance: 1500 } };
export const Brand: Story = { args: { balance: 5000, variant: "brand" } };
export const BrandLarge: Story = {
  args: { balance: 5100, variant: "brand", size: "lg" },
};
export const Lime: Story = { args: { balance: 12500, variant: "lime" } };
export const LimeLarge: Story = {
  args: { balance: 12500, variant: "lime", size: "lg" },
};
export const LowBalance: Story = { args: { balance: 25, variant: "warning" } };
export const Compact: Story = { args: { balance: 250, compact: true } };
export const Small: Story = { args: { balance: 1500, size: "sm" } };
export const Single: Story = { args: { balance: 1 } };
