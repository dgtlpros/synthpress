import type { Meta, StoryObj } from "@storybook/react";
import { Features } from "./Features";

const meta = {
  title: "Organisms/Features",
  component: Features,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Features>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
