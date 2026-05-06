import type { Meta, StoryObj } from "@storybook/react";
import { InvoiceListSkeleton } from "./InvoiceListSkeleton";

const meta = {
  title: "Atoms/InvoiceListSkeleton",
  component: InvoiceListSkeleton,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof InvoiceListSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: {} };

export const ShortList: Story = { args: { rows: 2 } };

export const LongList: Story = { args: { rows: 8 } };
