import type { Meta, StoryObj } from "@storybook/react";
import { Pricing } from "./Pricing";

const meta = {
  title: "Organisms/Pricing",
  component: Pricing,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Pricing>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
