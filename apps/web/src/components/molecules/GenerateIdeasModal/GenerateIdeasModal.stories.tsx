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
 * Wrapper component so the brief textarea behaves interactively in
 * Storybook. Defining it at module scope (rather than inside `render`)
 * keeps `react-hooks/rules-of-hooks` happy.
 */
function InteractiveModal({
  initialBrief = "",
  ...args
}: Omit<
  Parameters<typeof GenerateIdeasModal>[0],
  "brief" | "onBriefChange"
> & { initialBrief?: string }) {
  const [brief, setBrief] = useState(initialBrief);
  return (
    <GenerateIdeasModal
      {...args}
      brief={brief}
      onBriefChange={setBrief}
      open
    />
  );
}

export const Default: Story = {
  args: {
    open: true,
    onClose: () => {},
    brief: "",
    onBriefChange: () => {},
    onSubmit: () => {},
    count: 10,
    creditsCost: 1,
  },
  render: (args) => <InteractiveModal {...args} />,
};

export const Pending: Story = {
  args: {
    open: true,
    onClose: () => {},
    brief: "AI agents in production",
    onBriefChange: () => {},
    onSubmit: () => {},
    count: 10,
    creditsCost: 1,
    pending: true,
  },
};

export const WithError: Story = {
  args: {
    open: true,
    onClose: () => {},
    brief: "",
    onBriefChange: () => {},
    onSubmit: () => {},
    count: 10,
    creditsCost: 1,
    errorMessage: "Not enough synth tokens to generate ideas.",
  },
};
