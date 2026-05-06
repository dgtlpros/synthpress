import type { Meta, StoryObj } from "@storybook/react";
import { IconButton } from "./IconButton";

const meta = {
  title: "Atoms/IconButton",
  component: IconButton,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Settings", children: "\u2699" },
};
export const Ghost: Story = {
  args: { label: "Menu", variant: "ghost", children: "\u2630" },
};
export const Brand: Story = {
  args: { label: "Add", variant: "brand", children: "+" },
};
export const Small: Story = {
  args: { label: "Close", size: "sm", children: "\u2715" },
};
