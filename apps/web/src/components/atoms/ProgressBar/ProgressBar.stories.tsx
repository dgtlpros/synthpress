import type { Meta, StoryObj } from "@storybook/react";
import { ProgressBar } from "./ProgressBar";

const meta = {
  title: "Atoms/ProgressBar",
  component: ProgressBar,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["brand", "success", "warning", "error", "default"],
    },
    size: { control: "select", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { value: 45, label: "Default" },
};

export const Empty: Story = { args: { value: 0, label: "Empty" } };

export const TinyButVisible: Story = {
  args: { value: 2, label: "Tiny but visible" },
};

export const Complete: Story = {
  args: { value: 100, variant: "success", label: "Complete" },
};

export const Failed: Story = {
  args: { value: 100, variant: "error", label: "Failed" },
};

export const Refunded: Story = {
  args: { value: 100, variant: "warning", label: "Failed · Refunded" },
};

export const Small: Story = {
  args: { value: 60, size: "sm", label: "Small" },
};

export const Large: Story = {
  args: { value: 60, size: "lg", label: "Large" },
};
