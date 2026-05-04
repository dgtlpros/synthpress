import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./Input";

const meta = {
  title: "Atoms/Input",
  component: Input,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { placeholder: "Enter your email..." } };
export const WithValue: Story = { args: { defaultValue: "hello@synthpress.com" } };
export const Error: Story = { args: { placeholder: "Invalid email", error: true } };
export const Disabled: Story = { args: { placeholder: "Disabled", disabled: true } };
