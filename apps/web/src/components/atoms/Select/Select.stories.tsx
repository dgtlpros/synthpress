import type { Meta, StoryObj } from "@storybook/react";
import { Select } from "./Select";

const nicheOptions = [
  { value: "fitness", label: "Fitness" },
  { value: "tech", label: "Technology" },
  { value: "pets", label: "Pets & Animals" },
  { value: "finance", label: "Finance" },
];

const meta = {
  title: "Atoms/Select",
  component: Select,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { options: nicheOptions, placeholder: "Select a niche..." } };
export const WithValue: Story = { args: { options: nicheOptions, defaultValue: "tech" } };
export const Error: Story = { args: { options: nicheOptions, placeholder: "Required", error: true } };
export const Disabled: Story = { args: { options: nicheOptions, defaultValue: "fitness", disabled: true } };
