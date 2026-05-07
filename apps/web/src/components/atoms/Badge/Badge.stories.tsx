import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./Badge";

const meta = {
  title: "Atoms/Badge",
  component: Badge,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "success", "warning", "error", "brand", "lime"],
    },
    size: { control: "select", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "Draft" } };
export const Success: Story = {
  args: { children: "Published", variant: "success" },
};
export const Warning: Story = {
  args: { children: "Generating", variant: "warning" },
};
export const Error: Story = { args: { children: "Failed", variant: "error" } };
export const Brand: Story = { args: { children: "Pro", variant: "brand" } };
export const Lime: Story = {
  args: { children: "Public Beta", variant: "lime" },
};
export const Small: Story = {
  args: { children: "New", size: "sm", variant: "brand" },
};
