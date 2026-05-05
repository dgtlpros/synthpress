import type { Meta, StoryObj } from "@storybook/react";
import { Skeleton } from "./Skeleton";

const meta = {
  title: "Atoms/Skeleton",
  component: Skeleton,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["rect", "pill", "circle"] },
  },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TextLine: Story = {
  render: () => <Skeleton className="h-4 w-48" />,
};

export const Heading: Story = {
  render: () => <Skeleton className="h-8 w-64" />,
};

export const Pill: Story = {
  render: () => <Skeleton variant="pill" className="h-6 w-24" />,
};

export const Avatar: Story = {
  render: () => <Skeleton variant="circle" className="h-12 w-12" />,
};

export const CheckoutShape: Story = {
  render: () => (
    <div className="flex w-[480px] flex-col gap-4 rounded-[var(--sp-radius-xl)] border border-border bg-surface p-6">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <div className="flex gap-3">
        <Skeleton className="h-12 flex-1" />
        <Skeleton className="h-12 w-32" />
      </div>
      <Skeleton className="h-11 w-full" />
    </div>
  ),
};
