import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta = {
  title: "Atoms/Button",
  component: Button,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["primary", "secondary", "ghost", "danger"] },
    size: { control: "select", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { children: "Publish Article", variant: "primary" } };
export const Secondary: Story = { args: { children: "Cancel", variant: "secondary" } };
export const Ghost: Story = { args: { children: "Settings", variant: "ghost" } };
export const Danger: Story = { args: { children: "Delete Project", variant: "danger" } };
export const Small: Story = { args: { children: "Small", size: "sm" } };
export const Large: Story = { args: { children: "Get Started", size: "lg" } };
export const Loading: Story = { args: { children: "Publishing...", loading: true } };
export const Disabled: Story = { args: { children: "Disabled", disabled: true } };
