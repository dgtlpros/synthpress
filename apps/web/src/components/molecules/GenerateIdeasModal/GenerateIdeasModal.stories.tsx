import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { GenerateIdeasModal } from "./GenerateIdeasModal";

const meta = {
  title: "Molecules/GenerateIdeasModal",
  component: GenerateIdeasModal,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof GenerateIdeasModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Wrapper component so the brief textarea + count selector behave
 * interactively in Storybook. Defining it at module scope (rather
 * than inside `render`) keeps `react-hooks/rules-of-hooks` happy.
 */
function InteractiveModal({
  initialBrief = "",
  initialCount = 5,
  ...args
}: Omit<
  Parameters<typeof GenerateIdeasModal>[0],
  "brief" | "onBriefChange" | "count" | "onCountChange"
> & {
  initialBrief?: string;
  initialCount?: number;
}) {
  const [brief, setBrief] = useState(initialBrief);
  const [count, setCount] = useState(initialCount);
  return (
    <GenerateIdeasModal
      {...args}
      brief={brief}
      onBriefChange={setBrief}
      count={count}
      onCountChange={setCount}
      open
    />
  );
}

const baseArgs = {
  open: true,
  onClose: () => {},
  brief: "",
  onBriefChange: () => {},
  onSubmit: () => {},
  count: 5,
  onCountChange: () => {},
  creditsCost: 1,
};

export const Default: Story = {
  args: baseArgs,
  render: (args) => <InteractiveModal {...args} />,
};

export const Pending: Story = {
  args: {
    ...baseArgs,
    brief: "AI agents in production",
    count: 10,
    pending: true,
  },
};

export const WithError: Story = {
  args: {
    ...baseArgs,
    errorMessage: "Not enough synth tokens to generate ideas.",
  },
};

export const CustomCount: Story = {
  args: { ...baseArgs, count: 12 },
  render: (args) => <InteractiveModal {...args} initialCount={12} />,
};
