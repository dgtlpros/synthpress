import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { SegmentedControl } from "./SegmentedControl";

const meta = {
  title: "Atoms/SegmentedControl",
  component: SegmentedControl,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

function BillingIntervalDemo() {
  const [value, setValue] = useState<"month" | "year">("month");
  return (
    <SegmentedControl
      ariaLabel="Billing interval"
      value={value}
      onChange={setValue}
      options={[
        { value: "month", label: "Monthly" },
        { value: "year", label: "Annual", badge: "Save 17%" },
      ]}
    />
  );
}

export const BillingInterval: Story = {
  args: {
    ariaLabel: "Billing interval",
    value: "month",
    onChange: () => {},
    options: [
      { value: "month", label: "Monthly" },
      { value: "year", label: "Annual", badge: "Save 17%" },
    ],
  },
  render: () => <BillingIntervalDemo />,
};

function NoBadgeDemo() {
  const [value, setValue] = useState<"a" | "b">("a");
  return (
    <SegmentedControl
      value={value}
      onChange={setValue}
      options={[
        { value: "a", label: "Option A" },
        { value: "b", label: "Option B" },
      ]}
    />
  );
}

export const NoBadge: Story = {
  args: {
    value: "a",
    onChange: () => {},
    options: [
      { value: "a", label: "Option A" },
      { value: "b", label: "Option B" },
    ],
  },
  render: () => <NoBadgeDemo />,
};
