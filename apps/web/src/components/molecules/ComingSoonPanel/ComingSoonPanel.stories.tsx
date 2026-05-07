import type { Meta, StoryObj } from "@storybook/react";
import { ComingSoonPanel } from "./ComingSoonPanel";

const meta = {
  title: "Molecules/ComingSoonPanel",
  component: ComingSoonPanel,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof ComingSoonPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Calendar",
    description:
      "Visualize your publishing cadence. Drag to reschedule. Spot gaps.",
    bullets: [
      "Month, week, and day views",
      "Drag-and-drop to reschedule",
      "Color-coded by status",
    ],
  },
};
