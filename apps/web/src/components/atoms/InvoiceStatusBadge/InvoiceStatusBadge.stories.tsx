import type { Meta, StoryObj } from "@storybook/react";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";

const meta = {
  title: "Atoms/InvoiceStatusBadge",
  component: InvoiceStatusBadge,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    status: {
      control: "select",
      options: ["paid", "open", "void", "uncollectible", "draft", "unknown"],
    },
  },
} satisfies Meta<typeof InvoiceStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Paid: Story = { args: { status: "paid" } };
export const Open: Story = { args: { status: "open" } };
export const Void: Story = { args: { status: "void" } };
export const Uncollectible: Story = { args: { status: "uncollectible" } };
export const Draft: Story = { args: { status: "draft" } };
export const Unknown: Story = { args: { status: "unknown" } };
