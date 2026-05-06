import type { Meta, StoryObj } from "@storybook/react";
import { Textarea } from "./Textarea";

const meta = {
  title: "Atoms/Textarea",
  component: Textarea,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { placeholder: "Enter your AI prompt template..." },
};
export const WithValue: Story = {
  args: {
    defaultValue:
      "Write a 1000-word article about {{topic}} in the {{niche}} space.",
  },
};
export const Error: Story = {
  args: { placeholder: "Required field", error: true },
};
export const Disabled: Story = {
  args: { placeholder: "Disabled", disabled: true },
};
