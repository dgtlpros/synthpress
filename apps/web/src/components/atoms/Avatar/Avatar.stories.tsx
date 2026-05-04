import type { Meta, StoryObj } from "@storybook/react";
import { Avatar } from "./Avatar";

const meta = {
  title: "Atoms/Avatar",
  component: Avatar,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Fallback: Story = { args: { fallback: "SP", size: "md" } };
export const Small: Story = { args: { fallback: "A", size: "sm" } };
export const Large: Story = { args: { fallback: "SP", size: "lg" } };
