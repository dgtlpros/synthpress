import type { Meta, StoryObj } from "@storybook/react";
import { HowItWorks } from "./HowItWorks";

const meta = {
  title: "Organisms/HowItWorks",
  component: HowItWorks,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HowItWorks>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
